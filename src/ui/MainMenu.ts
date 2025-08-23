import { Logger } from '../core/Logger';
import { matrixBackground } from './MatrixBackground';
import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
// Static imports for auth/score services to avoid mixed dynamic+static warnings in Vite
import { googleAuthService } from '../auth/AuthService';
import { fetchTop, getPlayerId, resolveBoard, sanitizeName, isLeaderboardConfigured, fetchPlayerEntry, loadSnapshot, rewriteNickname, invalidateLeaderboardCache, isNicknameAvailable, claimNickname } from '../leaderboard';

interface PlayerProfile {
  currency: number;
  permanentUpgrades: {
    healthBoost: number;
    damageBoost: number;
    speedBoost: number;
    luckBoost: number;
  };
  unlockedCharacters: string[];
  highScores: { [characterId: string]: number };
}

export class MainMenu {
  private mainMenuElement: HTMLElement | null = null;
  private gameInstance: any;
  private matrixDrops?: number[];
  private _matrixChars?: string[];
  private playerProfile: PlayerProfile;
  private selectedMode: 'SHOWDOWN' | 'DUNGEON' = 'SHOWDOWN';
  private authUnsub?: () => void;
  private authUser: import('../auth/AuthService').GoogleUserProfile | null = null;
  private incrementalEntries: any[] = [];
  private playerId: string = getPlayerId();
  private currentBoard: string = 'global';
  /** Patch notes for current day only (auto-dated). Newest entries first in array. */
  private patchNotesHistory: { version: string; date: string; entries: { tag: 'NEW'|'UI'|'BAL'|'FX'|'QOL'|string; text: string }[] }[] = (() => {
    const today = new Date().toISOString().slice(0,10);
    return [
      {
        version: '0.2.5',
        date: today,
        entries: [
          { tag: 'NEW', text: 'Passive — Area Up added: +10% radius per level across compatible area effects.' },
          { tag: 'SYS', text: 'Global area multiplier framework — AoE systems now scale consistently: Data Sigils, Titan Mortar, Shockwaves, Plasma Detonation, and On‑Kill pulses.' },
          { tag: 'BAL', text: 'Beam melter — reduced knockback and enforced radial push from player for stable target lock.' },
          { tag: 'QOL', text: 'Standardized multiplier getters (damage/area/fire‑rate); cooldowns and damage paths honor passives uniformly.' },
          { tag: 'FIX', text: 'Prevented double‑scaling of AoE; ensured explosionRadius propagation through event chain.' }
        ]
      },
      {
        version: '0.2.4',
        date: today,
        entries: [
          { tag: 'FX', text: 'Umbral Surge — integrated MP4 overlay with auto-transparency, darker purple tint, and smoother, longer fade-out.' },
          { tag: 'UI', text: 'Upgrade choices — integer-only stat deltas with bold arrows/colors; class badge shows only on unlock.' },
          { tag: 'UI', text: 'HUD — health now displays whole numbers only for better readability.' },
          { tag: 'NEW', text: 'Tech Warrior — Glide Dash (Shift): short, smooth dash with brief i-frames and afterimages; dedicated ability bar added.' },
          { tag: 'BAL', text: 'Heavy Gunner — Overdrive uptime doubled, cooldown halved, no startup heat cost; +2 pierce during boost; steadier recoil/spread.' },
          { tag: 'NEW', text: 'Boss — two telegraphed spells: Shock Nova (charge ring → expanding blast) and Line Dash (floor lineup → high‑speed dash).'},
          { tag: 'BAL', text: 'Boss — on‑hit parity with enemies (armor shred, burn, poison, glitch) with periodic DoT ticks for consistency.' },
          { tag: 'FX', text: 'Tachyon Spear — cyan/blue visuals and trail; flight physics feel heavier with ease‑in acceleration, light drag, and per‑pierce slowdown.' }
        ]
      },
      {
        version: '0.2.3',
        date: today,
        entries: [
          { tag: 'BAL', text: 'SNIPER PATCH — Charge bar is authoritative: Ghost and Shadow snipers fire the instant the bar fills (no cooldown waits or post-shot idle).'},
          { tag: 'FX', text: 'Shadow (Void Sniper): dark purple stack particles above tagged enemies; clearer visual feedback for DoT stacks.'},
          { tag: 'BAL', text: 'Void Sniper charge time increased by 50% (375ms during Umbral Surge, 1050ms normal).'},
          { tag: 'QOL', text: 'Applying a new Void DoT stack now deals an immediate tick so enemies can’t “dodge” the first damage.'}
        ]
      },
      {
        version: '0.2.2',
        date: today,
        entries: [
          { tag: 'NEW', text: 'Rogue Hacker rework — System Hack ultimate added: a massive EMP-like hack that deals damage in a large radius and paralyzes enemies briefly.' },
          { tag: 'FX', text: 'RGB glitch visuals made far more visible on hacked enemies (stronger color ghosts, slices, scanlines, and duration).'},
          { tag: 'UI', text: 'HUD adds a Rogue Hacker ability meter with clear READY state and cooldown countdown.' }
        ]
      },
      {
        version: '0.2.1',
        date: today,
        entries: [
          { tag: 'SYS', text: 'Leaderboard: time is the rank key; per‑board metadata now locks Kills/Level/Operative to the exact record run.' },
          { tag: 'UI', text: 'Highscores: “All Operatives” now shows one entry per name; consistent operative labels across all boards.' },
          { tag: 'BAL', text: 'Passive Regen now applies continuously with fractional accumulation (matches balance tests).' },
          { tag: 'BAL', text: 'Bio Engineer — Bio Toxin DoT scales strongly with weapon level and global damage; impact damage is secondary.' },
          { tag: 'OPS', text: 'Neural Nomad — Overmind Overload reworked to a single powerful detonation; per‑shot thread ownership.' },
          { tag: 'FX', text: 'Overmind hits add a brief RGB “old TV” glitch on affected enemies.' },
          { tag: 'NEW', text: 'Psionic Wave ricochet: +1 bounce per level; avoids re‑hitting the same target.' }
        ]
      },
      {
        version: '0.2.0',
        date: today,
        entries: [
          { tag: 'MILESTONE', text: 'OPERATIVES PATCH — Full class pass complete: every operative reworked with unique active abilities and refreshed kits.' },
          { tag: 'OPS', text: 'Abilities: Phase Cloak (Ghost), Data Sigils (Sorcerer), Overdrive (Heavy), Surge Dash (Runner), Virus Zones (Hacker), Weaver Lattice (Psionic), Grinder Harness (Mech), Neural Threader (Nomad), and more.' },
          { tag: 'NEW', text: 'New/updated class weapons across the roster with 7‑level progressions; distinct visuals and role per class.' },
          { tag: 'BAL', text: 'Global tuning: standardized base HP/speed/damage curves; per‑class cooldowns, damage, and AoE retuned; XP economy adjusted for ~10m builds.' },
          { tag: 'SYS', text: 'Ability framework integrated with HUD (unique bars), AI hooks, and explosion/particle routing.' },
          { tag: 'UI', text: 'Character Select readability & tips overhaul; main menu patch notes upgraded (multi-version, scrollable) with larger typography.' },
          { tag: 'PERF', text: 'EnemyManager micro-optimizations and background rendering tweaks to smooth frame pacing.' }
        ]
      },
      {
        version: '0.1.1',
        date: today,
        entries: [
          { tag: 'NEW', text: 'Quantum Halo weapon: small orbiting orbs rotate clockwise, pass-through hits with 1s per‑enemy cooldown, stronger knockback, and orbit radius scales +10%/level.' },
          { tag: 'BAL', text: 'Enemy chase speed capped to ≈120% of player speed to reduce runaway pressure while preserving difficulty.' },
          { tag: 'FX', text: 'XP orbs now render as efficient 5‑point stars with a subtle glow (very low performance cost).' },
          { tag: 'QOL', text: 'Stability: adjusted Speed passive scaling to match balance tests; minor backend test stub added.' }
        ]
      },
      {
        version: '0.1.0',
        date: today,
        entries: [
          // Newest first (today only)
          { tag: 'BAL', text: 'Infinite boss scaling added: HP / special & contact damage grow each spawn; spawn every 180s (≈3 per 10m run).' },
          { tag: 'BAL', text: 'Extended weapon progression: most weapons +2 levels (to 7); Shotgun to 10; revised DPS + cooldown tables; smoother late taper.' },
          { tag: 'BAL', text: 'Passive upgrades +2 levels (now up to 7) except Piercing (3) & AOE (1); adjusted per‑level bonuses to avoid runaway scaling.' },
          { tag: 'BAL', text: 'Experience economy retuned: higher quadratic XP curve, reduced gem upgrade probability (60%), lowered medium/large gem tiers.' },
          { tag: 'BAL', text: 'Ricochet & Homing reworks: Ricochet 7 levels (up to 9 bounces, stronger scaling); Homing Drone geometric damage curve to L7.' },
          { tag: 'QOL', text: 'Boss defeat triggers gem vacuum + upgrade reward event; smoother late-run cleanup.' },
          { tag: 'UI', text: 'Patch notes panel typography enlarged & filtered to today-only block (newest-first).' },
          { tag: 'BAL', text: 'Player XP pacing targets max build ≈10 minutes; supports extended progression window.' },
          { tag: 'NEW', text: 'Plasma Core implemented: charge → travel → detonate with fragments or overcharged ion field pulses.' },
          { tag: 'BAL', text: 'Drone explosion: ~300% area, double damage, cyan ion visuals & residual zone.' },
          { tag: 'BAL', text: 'Enemy death AoE: toned visuals, restored full damage, slight radius increase.' },
          { tag: 'FX', text: 'Titan Mech mortar: multi-ring detonation & pre-implosion sequence.' },
          { tag: 'UI', text: 'Highscores panel reworked to strict table with DPS column and silent diff refresh.' },
          { tag: 'QOL', text: 'Removed statistics button; default operative auto-selected.' }
        ]
      }
    ];
  })();

  constructor(game: any) {
    this.gameInstance = game;
    this.playerProfile = this.loadPlayerProfile();
    this.removeOldElements();
    this.createMainMenu();
    // Ensure Cyber Runner is the default selected operative if none chosen yet
    this.setDefaultCharacter();
    this.setupEventListeners();
    this.initializeMatrix();
  }

  /**
   * Sets Cyber Runner as the default selected character on the main menu
   * so the player can immediately start without opening the select panel.
   * Won't override an existing selection (e.g., returning to menu).
   */
  private setDefaultCharacter(): void {
    if (this.gameInstance.selectedCharacterData) return; // Preserve prior selection
    const cyber = CHARACTERS.find(c => c.id === 'cyber_runner');
    if (cyber) {
      this.gameInstance.selectedCharacterData = cyber;
      this.updateCharacterPreview(cyber);
      Logger.info('MainMenu: Default character set to cyber_runner');
    } else {
      Logger.warn('MainMenu: cyber_runner character not found in CHARACTERS list');
    }
  }

  private removeOldElements(): void {
    // Remove any old menu elements
    const oldMenu = document.getElementById('main-menu');
    const oldCharacterSelect = document.getElementById('character-select-panel');
    
    if (oldMenu) oldMenu.remove();
    if (oldCharacterSelect) oldCharacterSelect.remove();
  }

  private loadPlayerProfile(): PlayerProfile {
    const saved = localStorage.getItem('cybersurvivor-profile');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      currency: 0,
      permanentUpgrades: {
        healthBoost: 0,
        damageBoost: 0,
        speedBoost: 0,
        luckBoost: 0
      },
      unlockedCharacters: ['wasteland_scavenger', 'tech_warrior', 'heavy_gunner'],
      highScores: {}
    };
  }

  private savePlayerProfile(): void {
    localStorage.setItem('cybersurvivor-profile', JSON.stringify(this.playerProfile));
  }

  private createMainMenu(): void {
    this.mainMenuElement = document.createElement('div');
    this.mainMenuElement.id = 'main-menu';
    this.mainMenuElement.className = 'cyberpunk-main-menu';
    this.mainMenuElement.innerHTML = `
      <div class="matrix-bg-overlay"></div>
      <div class="main-menu-shell" id="main-menu-adaptive">
        <header class="mm-header">
          <div class="logo-block">
            <div class="logo-main">CYBER<span>SURVIVOR</span></div>
            <div class="version-tag">v0.2.5 — GENERAL UPDATE PATCH</div>
          </div>
          <div class="profile-block">
            <div class="currency-display compact">
              <span class="currency-icon">⚡</span>
              <span id="currency-amount">${this.playerProfile.currency}</span>
            </div>
            <div class="auth-container" id="auth-container">
              <button class="cyberpunk-btn tertiary-btn tight hidden-init" id="login-btn">
                <span class="btn-text">SIGN IN</span>
                <span class="btn-glow"></span>
              </button>
              <div class="auth-profile hidden-init" id="auth-profile" style="display:flex;align-items:center;gap:8px;">
                <img id="auth-avatar" class="auth-avatar" alt="User" />
                <div class="auth-meta" style="display:flex;flex-direction:column;gap:2px;">
                  <div class="auth-nick" id="auth-name"></div>
                  <div class="auth-email" id="auth-email"></div>
                </div>
                <button id="change-nickname-btn" class="mini-logout" title="Change Nickname" style="margin-left:8px">✎</button>
                <button id="logout-btn" class="mini-logout" title="Sign Out">✕</button>
              </div>
            </div>
          </div>
        </header>
  <main class="mm-main">
          <section class="panel left nav-panel">
            <button class="main-cta" id="start-mission-btn">START RUN</button>
            <div class="mode-select-block">
              <label for="game-mode-select">MODE</label>
              <select id="game-mode-select" class="mode-select">
                <option value="SHOWDOWN" selected>Showdown (Open)</option>
                <option value="DUNGEON">Dungeon (Rooms)</option>
              </select>
              <div id="mode-desc" class="mode-desc"></div>
            </div>
            <div class="nav-buttons">
              <button class="nav-btn" id="character-select-btn">Operatives</button>
              <button class="nav-btn" id="upgrades-btn">Upgrades ${this.playerProfile.currency > 0 ? '<span class="notification-dot"></span>' : ''}</button>
                 <!-- Statistics button removed -->
            </div>
            <div class="patch-notes-container" id="patch-notes">
              <div class="pn-header">PATCH NOTES</div>
              <div class="pn-body" id="patch-notes-body"></div>
            </div>
            <!-- spacer removed; patch notes now stretch to bottom -->
          </section>
          <section class="panel middle-column" id="middle-column">
            <div class="preview-panel compact" id="character-preview">
              <div class="preview-upper">
                <div class="preview-portrait small" id="preview-portrait">
                  <img src="${(window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/player/wasteland_scavenger.png') : (location.protocol==='file:'?'./assets/player/wasteland_scavenger.png':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/player/wasteland_scavenger.png':'/assets/player/wasteland_scavenger.png'))}" alt="Character" />
                </div>
                <div class="preview-meta">
                  <div class="preview-name" id="preview-name">Select Character</div>
                  <div class="preview-stats" id="preview-stats"></div>
                </div>
              </div>
              <div class="weapon-info-combined" id="weapon-info-section">
                <div class="wic-header">CLASS WEAPON</div>
                <div class="wic-body" id="weapon-info-body">Select an operative…</div>
              </div>
            </div>
            <div class="mode-info-panel" id="mode-info-panel">
              <div class="mode-info-header">MODE INFO</div>
              <div class="mode-info-body" id="mode-info-body">Loading…</div>
            </div>
            <!-- spacer removed; mode info now stretches to panel bottom -->
          </section>
          <section class="panel right highscores-panel wide2" id="highscores-panel">
            <div class="hs-header" id="hs-title">HIGHSCORES</div>
            <div class="hs-board-select" style="margin:4px 0 6px;display:flex;gap:4px;flex-wrap:wrap">
              <button class="nav-btn mini" data-board="global" style="padding:3px 6px;font-size:11px">Global</button>
              <button class="nav-btn mini" data-board="daily:auto" style="padding:3px 6px;font-size:11px">Daily</button>
              <button class="nav-btn mini" data-board="weekly:auto" style="padding:3px 6px;font-size:11px">Weekly</button>
              <button class="nav-btn mini" data-board="monthly:auto" style="padding:3px 6px;font-size:11px">Monthly</button>
              <select id="hs-op-select" class="nav-btn mini" style="padding:3px 6px;font-size:11px;min-width:160px">
                <option value="">All Operatives</option>
              </select>
            </div>
            <div class="hs-panel" id="hs-remote-board">No scores yet.</div>
            <button class="nav-btn" id="hs-load-more" style="margin-top:6px;font-size:11px;padding:4px 6px;">Refresh</button>
          </section>
        </main>
        <footer class="mm-footer">
          <div class="status-line offline"><span class="status-dot"></span>NEURAL LINK OFFLINE</div>
        </footer>
      </div>`;

    document.body.appendChild(this.mainMenuElement);
    // Adaptive scaling
    import('./ViewportScaler').then(mod => {
      const adaptive = document.getElementById('main-menu-adaptive');
      if (adaptive) mod.attachAdaptiveScaler(adaptive as HTMLElement, {
        baseWidth: 1920,
        baseHeight: 1080,
        // Stretch so the logical canvas fills viewport (no margins)
        // Allow independent X/Y scaling; enable vertical expansion.
        minScale: 0.5,
        maxScale: 3,
        allowUpscale: true,
        mode: 'stretch',
        adaptiveHeight: true
      });
    }).catch(()=>{});
    // Show sound panel (if exists) while in main menu
    const soundPanel = document.getElementById('sound-settings-panel');
    if (soundPanel) soundPanel.style.display = 'block';
    // Auth init (static import to avoid chunk duplication warnings)
    const loginBtn = document.getElementById('login-btn');
    const authProfile = document.getElementById('auth-profile');
  if (loginBtn) {
      // Always keep button enabled so we can capture clicks for diagnostics; attempt lazy config refresh.
      if (!googleAuthService.isConfigured()) {
        const refreshed = googleAuthService.refreshClientIdFromMeta?.();
        if (!refreshed) {
          loginBtn.title = 'Google Sign-In not yet configured (meta missing)';
        } else {
          loginBtn.title = 'Sign in with Google';
        }
      } else {
        loginBtn.title = 'Sign in with Google';
      }
      loginBtn.removeAttribute('disabled');
      // Set initial visibility based on current auth state to avoid flicker
      const currentUser = googleAuthService.getCurrentUser();
      if (currentUser) {
        loginBtn.style.display = 'none';
        loginBtn.classList.add('hidden-init');
        const prof = document.getElementById('auth-profile');
        if (prof) { prof.classList.remove('hidden-init'); (prof as HTMLElement).style.display = 'flex'; }
      } else {
        loginBtn.style.display = 'inline-flex';
        loginBtn.classList.remove('hidden-init');
      }
      loginBtn.addEventListener('click', () => {
        Logger.info('[AuthUI] SIGN IN raw click handler entered (configured=' + googleAuthService.isConfigured() + ', ready=' + googleAuthService.isReady() + ')');
        if (!googleAuthService.isConfigured()) {
          const refreshed = googleAuthService.refreshClientIdFromMeta?.();
          Logger.warn('[AuthUI] Not configured on click; refresh attempt result=', refreshed);
          if (!refreshed) return; // still not configured
        }
        Logger.info('[AuthUI] SIGN IN clicked');
        // If GIS not ready yet, immediately attempt new-tab flow (synchronous window.open) to avoid popup blocking.
        if (!googleAuthService.isReady()) {
          Logger.info('[AuthUI] GIS not ready – launching new-tab id_token flow and preloading script');
          googleAuthService.openNewTabSignIn().catch(e=>Logger.warn('[AuthUI] new-tab flow error', e));
          // Kick off preload (no await so gesture remains for window.open already executed)
          googleAuthService.preload().catch(()=>{});
          return;
        }
        // Try popup access token flow first (non-blocking); don't await before potential fallbacks.
        googleAuthService.popupAccessSignIn().then(user => {
          if (user) { Logger.info('[AuthUI] popup access flow succeeded'); return; }
          Logger.info('[AuthUI] popup access flow returned null, trying new-tab');
          return googleAuthService.openNewTabSignIn();
        }).then(user => {
          if (user) { Logger.info('[AuthUI] new-tab flow succeeded'); return; }
          Logger.info('[AuthUI] new-tab flow returned null, opening fallback modal');
          return googleAuthService.openLogin();
        }).catch(e => {
          Logger.warn('[AuthUI] sign-in sequence error', e);
          googleAuthService.openLogin().catch(()=>{});
        });
      });
    }
    if (authProfile) {
      authProfile.addEventListener('click', () => {
        const dd = document.getElementById('auth-dropdown');
        if (dd) dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      });
    }
    // Proactively preload GIS script in background after slight delay to mitigate first-click latency.
    if (googleAuthService.isConfigured()) {
      setTimeout(()=>{ googleAuthService.preload().catch(()=>{}); }, 200);
    }

    // --- Instrumentation for diagnosing missing click events ---
    // Global capture listener to log any click events hitting or bubbling from the login button.
    if (!(window as any).__loginBtnDebugInstalled) {
      (window as any).__loginBtnDebugInstalled = true;
      window.addEventListener('click', (ev) => {
        const t = ev.target as HTMLElement | null;
        if (!t) return;
        if (t.id === 'login-btn' || t.closest('#login-btn')) {
          Logger.info('[AuthUI][Debug] Global click observed on #login-btn (target=' + t.tagName + ')');
        }
      }, true);
    }
    // Force pointer-events + z-index for safety (some cascading styles may interfere in certain layouts/resolutions).
    const lb = document.getElementById('login-btn') as HTMLElement | null;
    if (lb) { lb.style.pointerEvents = 'auto'; lb.style.zIndex = '1000'; }
    const logoutBtn = document.getElementById('logout-btn') as HTMLElement | null;
    if (logoutBtn) {
      // Safety: ensure the logout button is interactable and above overlays
      logoutBtn.style.pointerEvents = 'auto';
      logoutBtn.style.zIndex = '1001';
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        googleAuthService.signOut();
        // Immediately refresh UI even if an auth event gets delayed
        this.authUser = null;
        this.updateAuthUI();
        this.refreshHighScores(true);
        const dd = document.getElementById('auth-dropdown');
        if (dd) dd.style.display = 'none';
      });
      // Global fallback in capture phase in case another element blocks bubbling
      if (!(window as any).__logoutBtnDebugInstalled) {
        (window as any).__logoutBtnDebugInstalled = true;
        window.addEventListener('click', (ev) => {
          const t = ev.target as HTMLElement | null;
          if (!t) return;
          if (t.id === 'logout-btn' || t.closest('#logout-btn')) {
            try { ev.stopPropagation(); } catch {}
            try { ev.preventDefault(); } catch {}
            googleAuthService.signOut();
            this.authUser = null; this.updateAuthUI(); this.refreshHighScores(true);
            const dd = document.getElementById('auth-dropdown'); if (dd) dd.style.display = 'none';
          }
        }, true);
      }
    }
    // Change nickname quick action next to currency
    const changeNickBtn = document.getElementById('change-nickname-btn') as HTMLButtonElement | null;
    if (changeNickBtn) {
      changeNickBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.authUser) {
          // If not signed in, prompt sign-in first
          googleAuthService.openLogin().catch(()=>{});
          return;
        }
        this.showNicknameModal();
      });
    }
    this.authUnsub = googleAuthService.subscribe(user => {
      this.authUser = user;
      this.updateAuthUI();
      this.refreshHighScores();
    });
  // Periodic refresh every 5 minutes
  const loop = () => { this.refreshHighScores(true); setTimeout(loop, 300000); }; setTimeout(loop, 300000);
    if (!document.getElementById('mm-hs-styles')) {
    const style = document.createElement('style');
      style.id = 'mm-hs-styles';
  style.textContent = `/* Layout grid */
  /* Make the main menu fill the viewport and allow scrolling when cramped */
  #main-menu{position:fixed;inset:0;overflow:auto;display:flex;flex-direction:column}
  .mm-footer{position:fixed;left:0;right:0;top:0;display:flex;justify-content:center;align-items:center;padding:6px 0;pointer-events:none;z-index:5}
  .status-line{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:1px}
  .status-line .status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:0 0 8px currentColor}
  .status-line.online{color:#59ff87}
  .status-line.online .status-dot{background:#59ff87}
  .status-line.offline{color:#ff5964}
  .status-line.offline .status-dot{background:#ff5964}
  .main-menu-shell{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
  .mm-header{flex:0 0 auto}
  .mm-main{display:grid;grid-template-columns:18% 34% 1fr;grid-template-rows:1fr;grid-template-areas:'nav middle hs';gap:28px;align-items:stretch;align-content:stretch;padding:0 8px 0 0;margin:0;flex:1 1 auto;min-height:0}
  .panel{margin:0}
  .nav-panel{grid-area:nav;display:flex;flex-direction:column;height:100%;min-height:0;}  
  .nav-panel .nav-buttons{display:flex;flex-direction:column;gap:10px;margin-top:14px}
  .nav-panel .main-cta{font-size:18px}
  .nav-panel .nav-btn{font-size:14px}
  .patch-notes-container{margin-top:16px;flex:1 1 auto;display:flex;flex-direction:column;border:1px solid rgba(0,255,255,0.28);background:rgba(0,25,38,0.28);backdrop-filter:blur(4px);padding:10px 10px 8px;min-height:160px;overflow:auto;position:relative}
  .patch-notes-container:before{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:0 0 12px rgba(0,255,255,0.12) inset}
  .pn-header{font-size:18px;letter-spacing:1.2px;font-weight:700;margin-bottom:8px;color:#5EEBFF;text-shadow:0 0 6px #0ff}
  .pn-body{flex:1 1 auto;overflow:auto;font-size:13.5px;line-height:1.5;padding-right:4px}
  .pn-body::-webkit-scrollbar{width:6px}
  .pn-body::-webkit-scrollbar-thumb{background:linear-gradient(#00eaff,#007f99);border-radius:3px}
  .pn-entry{margin-bottom:6px}
  .pn-entry.dim{opacity:0.55;font-style:italic;margin-top:4px}
  .pn-tag{display:inline-block;font-size:10px;padding:3px 6px;margin-right:6px;border:1px solid #0ff;border-radius:4px;background:rgba(0,255,255,0.12);letter-spacing:.6px}
  .pn-tag.new{border-color:#4CFF7A;color:#4CFF7A}
  .pn-tag.ui{border-color:#00C8FF;color:#00C8FF}
  .pn-tag.bal{border-color:#FFC400;color:#FFC400}
  .pn-tag.fx{border-color:#FF7A40;color:#FF7A40}
  .pn-tag.qol{border-color:#C38BFF;color:#C38BFF}
  .pn-tag.milestone{border-color:#7DFFDA;color:#7DFFDA}
  .pn-tag.ops{border-color:#9AE6FF;color:#9AE6FF}
  .pn-tag.sys{border-color:#94F7A7;color:#94F7A7}
  .pn-tag.perf{border-color:#FF8FB3;color:#FF8FB3}
  .pn-version{margin:12px 0 6px;font-weight:700;color:#5EEBFF;letter-spacing:1px;font-size:14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(0,255,255,0.25);padding-bottom:3px}
  .pn-version .date{font-weight:500;font-size:12px;color:#9adfff;opacity:0.9}
  #highscores-panel{grid-area:hs;display:flex;flex-direction:column;height:100%;min-height:0;overflow:auto;border:1px solid rgba(0,255,255,0.35);background:rgba(0,25,38,0.32);backdrop-filter:blur(4px);padding:10px 12px}
    #highscores-panel .hs-header{font-size:22px;margin-bottom:6px;letter-spacing:1px}
  .middle-column{grid-area:middle;display:flex;flex-direction:column;height:100%;min-height:0;gap:10px;overflow:hidden;}
  #character-preview.compact{display:flex;flex-direction:column;gap:10px;border:1px solid rgba(0,255,255,0.35);background:rgba(0,25,38,0.28);padding:10px 12px 10px;backdrop-filter:blur(4px);flex:0 0 auto;overflow:hidden}
  #character-preview .preview-upper{display:flex;flex-direction:column;align-items:center;gap:10px}
  #character-preview .preview-portrait.small{display:flex;align-items:center;justify-content:center;border:2px solid rgba(0,255,255,0.55);border-radius:50%;padding:8px;width:180px;height:180px;box-shadow:0 0 14px rgba(0,255,255,0.35) inset,0 0 12px rgba(0,255,255,0.25)}
  #character-preview .preview-portrait.small img{max-width:150px;image-rendering:pixelated;filter:drop-shadow(0 0 6px #0ff)}
  #character-preview .preview-name{font-size:32px;font-weight:600;color:#5EEBFF;text-shadow:0 0 8px #0ff,0 0 15px rgba(0,255,255,0.6);letter-spacing:1px;margin-top:6px}
  #character-preview .preview-stats{display:flex;justify-content:center;gap:48px;margin-top:10px;font-size:11px;letter-spacing:1px;color:#b8faff}
  #character-preview .preview-stats .stat-item{text-align:center}
  #character-preview .preview-stats .stat-label{display:block;font-size:10px;opacity:.7;margin-bottom:2px}
  .weapon-info-combined{flex:0 0 auto;display:flex;flex-direction:column;border:1px solid rgba(0,255,255,0.22);background:rgba(0,45,60,0.28);padding:8px 10px;min-height:96px;max-height:140px;position:relative}
  .weapon-info-combined:before{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:0 0 10px rgba(0,255,255,0.12) inset}
  .wic-header{font-size:16px;font-weight:700;color:#5EEBFF;letter-spacing:.8px;margin-bottom:6px;text-shadow:0 0 6px #0ff}
  .wic-body{flex:1;overflow:auto;font-size:12px;line-height:1.55;color:#b8faff;padding-right:4px}
  .wic-body::-webkit-scrollbar{width:6px}
  .wic-body::-webkit-scrollbar-thumb{background:linear-gradient(#00eaff,#007f99);border-radius:3px}
  .weapon-block{margin-bottom:2px}
  .weapon-block .w-name{font-weight:600;color:#5EEBFF;letter-spacing:.5px;font-size:12px;margin-bottom:2px}
  .weapon-block .w-desc{font-size:10px;opacity:.75;margin:2px 0 6px}
  .weapon-block .w-stats{font-size:9.5px;display:flex;flex-wrap:wrap;gap:4px;color:#9adfff}
  .weapon-block .w-stats span{background:rgba(0,255,255,0.08);padding:2px 5px;border:1px solid rgba(0,255,255,0.25);border-radius:4px}
  .mode-info-panel{flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(0,255,255,0.35);background:rgba(0,25,38,0.32);backdrop-filter:blur(4px);padding:12px 14px;min-height:0}
  .column-spacer{display:none}
  .mode-info-header{font-size:20px;font-weight:700;color:#5EEBFF;text-shadow:0 0 8px #0ff;letter-spacing:1.2px;margin-bottom:8px}
    .mode-info-body{flex:1;overflow:auto;font-size:14px;line-height:1.6;color:#b8faff;padding-right:4px;white-space:pre-line}
      /* Responsive height adjustments */
  @media (max-height:800px){
    .middle-column{gap:10px}
    #character-preview .preview-portrait.small{width:150px;height:150px;padding:6px}
    #character-preview .preview-portrait.small img{max-width:128px}
    #character-preview .preview-name{font-size:24px}
    .weapon-info-combined{max-height:120px}
    .mode-info-body{font-size:13px}
  }
  @media (max-height:860px){
        #character-preview .preview-portrait.small{width:160px;height:160px;padding:6px}
        #character-preview .preview-portrait.small img{max-width:135px}
    #character-preview .preview-name{font-size:26px}
    .weapon-info-combined{max-height:140px}
    .mode-info-body{font-size:12px}
      }
  @media (max-height:740px){
        #character-preview .preview-portrait.small{width:140px;height:140px;padding:4px}
        #character-preview .preview-portrait.small img{max-width:118px}
    #character-preview .preview-name{font-size:22px}
        .weapon-info-combined{max-height:130px}
      }
  .mode-info-body::-webkit-scrollbar{width:6px}
  .mode-info-body::-webkit-scrollbar-thumb{background:linear-gradient(#00eaff,#007f99);border-radius:3px}
  .mode-tags{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
  .mode-tag{font-size:9.5px;padding:3px 6px;border:1px solid rgba(0,255,255,0.35);background:rgba(0,255,255,0.08);border-radius:4px;letter-spacing:.5px;color:#9adfff}
    /* Highscores strict table */
  .highscores-panel .hs-table{display:grid;grid-template-columns:50px 1fr 120px 90px 110px 54px 80px;align-items:center;gap:0;font-size:14px;border-top:1px solid rgba(0,255,255,0.25);border-left:1px solid rgba(0,255,255,0.15)}
      .highscores-panel .hs-row{display:contents}
    .highscores-panel .hs-head span{font-weight:700;color:#5EEBFF;text-shadow:0 0 5px #0ff;font-size:13px;background:rgba(0,255,255,0.08);backdrop-filter:blur(2px)}
      .highscores-panel .hs-cell{padding:6px 8px;border-right:1px solid rgba(0,255,255,0.15);border-bottom:1px solid rgba(0,255,255,0.15);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .highscores-panel .hs-row.data:hover .hs-cell{background:rgba(0,255,255,0.08)}
      .highscores-panel .hs-row.me .hs-cell{background:rgba(0,160,255,0.28);box-shadow:0 0 6px #00cfff inset}
    .highscores-panel .hs-empty{opacity:.65;font-size:13px;margin-top:6px;text-align:center}
    /* Operative select readable theme */
    #hs-op-select{background:rgba(0,25,38,0.8);color:#b8faff;border:1px solid rgba(0,255,255,0.35);border-radius:4px}
    #hs-op-select option{background:#06212a;color:#b8faff}
  #hs-remote-board{flex:1 1 auto;min-height:0;overflow:auto;padding-right:4px}
      #hs-load-more{align-self:center;margin-top:8px;width:180px}
      /* Scrollbar styling */
      #hs-remote-board::-webkit-scrollbar{width:8px}#hs-remote-board::-webkit-scrollbar-track{background:rgba(0,0,0,0.2)}#hs-remote-board::-webkit-scrollbar-thumb{background:linear-gradient(#00eaff,#007f99);border-radius:4px}
      
      /* Responsive stacking for narrower width or short height */
      @media (max-width: 1200px), (max-height: 720px){
        .mm-main{grid-template-columns:1fr;grid-template-areas:'nav' 'middle' 'hs';gap:16px;padding:0 6px 16px 0}
        .nav-panel,.middle-column,#highscores-panel{height:auto;min-height:0}
        #highscores-panel{overflow:auto}
      }
      @media (max-height: 680px){
        .nav-panel .main-cta{font-size:16px}
        .nav-panel .nav-btn{font-size:12px}
        #character-preview .preview-name{font-size:22px}
        .pn-header{font-size:16px}
        #highscores-panel .hs-header{font-size:18px}
      }
      `;
      document.head.appendChild(style);
    }
    const loadMore = this.mainMenuElement.querySelector('#hs-load-more') as HTMLButtonElement | null;
    if (loadMore) {
      loadMore.addEventListener('click', () => {
        // Silent refresh to avoid wiping table and causing blur flicker
        loadMore.textContent = 'Refreshing…';
        loadMore.disabled = true;
        this.refreshHighScores(true).finally(()=>{
          loadMore.disabled = false;
          loadMore.textContent = 'Refresh';
        });
      });
    }
    // Initial load should be non-silent so user gets feedback if empty/error
    this.refreshHighScores(false);
    // Board selector events
    this.mainMenuElement.querySelectorAll('.hs-board-select [data-board]')
      .forEach(btn => btn.addEventListener('click', (e) => {
        const b = (e.currentTarget as HTMLElement).getAttribute('data-board') || 'global';
        this.currentBoard = b;
        this.refreshHighScores(true); // silent to preserve current table until new data arrives
      }));
    // Populate operative filter select
    const opSel = document.getElementById('hs-op-select') as HTMLSelectElement | null;
    if (opSel) {
      const seen = new Set<string>();
      for (let i = 0; i < CHARACTERS.length; i++) {
        const c = CHARACTERS[i];
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name || c.id;
        opSel.appendChild(opt);
      }
      opSel.addEventListener('change', () => {
        this.refreshHighScores(true);
      });
    }
    // Render structured patch notes
    this.renderPatchNotes();
  }

  private setupEventListeners(): void {
    const startBtn = document.getElementById('start-mission-btn');
    const characterBtn = document.getElementById('character-select-btn');
    const upgradesBtn = document.getElementById('upgrades-btn');
    // statistics button removed

    startBtn?.addEventListener('click', async () => {
      // Enforce Google sign-in before any run can start
      let user = googleAuthService.getCurrentUser();
      if (!user) {
        try { user = await googleAuthService.openLogin(); } catch { /* ignore */ }
      }
      if (!user) {
        // Block start if still not authenticated
        alert('Sign in with Google to start a run.');
        return;
      }
      if (this.gameInstance.selectedCharacterData) {
        this.hide();
        window.dispatchEvent(new CustomEvent('startGame', {
          detail: { character: this.gameInstance.selectedCharacterData, mode: this.selectedMode }
        }));
      } else {
        this.showCharacterSelect();
      }
    });

    characterBtn?.addEventListener('click', () => {
      this.showCharacterSelect();
    });

    upgradesBtn?.addEventListener('click', () => {
      this.showUpgrades();
    });

    // statistics listener removed

    // Listen for character selection
    window.addEventListener('characterSelected', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.gameInstance.selectedCharacterData = customEvent.detail;
      this.updateCharacterPreview(customEvent.detail);
  this.renderWeaponInfo();
    });

    // Listen for currency updates
    window.addEventListener('currencyEarned', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.playerProfile.currency += customEvent.detail.amount;
      this.savePlayerProfile();
      this.updateCurrencyDisplay();
    });

    // Game mode select logic
    const modeSelect = document.getElementById('game-mode-select') as HTMLSelectElement | null;
    const modeDesc = document.getElementById('mode-desc');
    const updateDesc = () => {
      if (!modeSelect || !modeDesc) return;
      const v = modeSelect.value as 'SHOWDOWN' | 'DUNGEON';
      this.selectedMode = v;
      if (v === 'SHOWDOWN') {
        modeDesc.textContent = 'Showdown: Vast open cyber expanse. No walls, enemies can surround from any direction.';
  this.updateModeInfoPanel('SHOWDOWN');
      } else {
        modeDesc.textContent = 'Dungeon: Procedurally linked rooms & corridors. Funnel enemies, explore branches.';
  this.updateModeInfoPanel('DUNGEON');
      }
    };
    if (modeSelect) {
      modeSelect.addEventListener('change', updateDesc);
      updateDesc();
    }
  // Initial weapon panel population after main menu created
  setTimeout(()=>this.renderWeaponInfo(),50);
  }

  private showCharacterSelect(): void {
    this.hide();
    window.dispatchEvent(new CustomEvent('showCharacterSelect'));
  }

  /**
   * Updates the MODE INFO panel with richer details about the selected game mode.
   */
  private updateModeInfoPanel(mode: 'SHOWDOWN' | 'DUNGEON'): void {
    const panel = document.getElementById('mode-info-body');
    if (!panel) return;
    if (mode === 'SHOWDOWN') {
      panel.innerHTML = `
<div class='mode-tags'>
  <span class='mode-tag'>OPEN</span>
  <span class='mode-tag'>SURROUND</span>
  <span class='mode-tag'>SCALING INTENSITY</span>
</div>
<div style='font-size:12px;font-weight:600;letter-spacing:.5px;margin-bottom:4px;color:#5EEBFF'>SHOWDOWN (OPEN)</div>
Large seamless arena with unconstrained spawn angles. Expect radial pressure and flanking.

STRATEGY:
• Maintain circular or figure-8 paths to layer projectile coverage.
• Prioritize mobility & wide-area damage early to avoid encirclement.
• Use mortar / AoE detonations to carve escape lanes when density spikes.

TIP: Diagonal drift (slight strafe + forward) continually reorients enemy approach vectors, reducing direct stacking.
`;
    } else {
      panel.innerHTML = `
<div class='mode-tags'>
  <span class='mode-tag'>ROOMS</span>
  <span class='mode-tag'>FUNNELS</span>
  <span class='mode-tag'>ROUTE CONTROL</span>
</div>
<div style='font-size:12px;font-weight:600;letter-spacing:.5px;margin-bottom:4px;color:#5EEBFF'>DUNGEON (ROOMS)</div>
Modular chambers connected by corridors. Manage engagement width to neutralize swarm advantages.

STRATEGY:
• Scout adjacent doors before aggro stacking.
• Fight near choke entrances to maximize multi-hit & DoT uptime.
• Reset pressure by kiting into cleared rooms.

TIP: Pull elites through a narrow corridor, then deploy burst / AoE behind them to trap trailing mobs in damage zones.
`;
    }
  }


  private showUpgrades(): void {
    // Create upgrades modal
    const upgradesModal = document.createElement('div');
    upgradesModal.className = 'cyberpunk-modal';
    upgradesModal.innerHTML = `
      <div class="modal-content upgrades-panel">
        <div class="modal-header">
          <h2>PERMANENT UPGRADES</h2>
          <button class="close-btn" id="close-upgrades">×</button>
        </div>
        <div class="upgrades-grid">
          <div class="upgrade-item">
            <div class="upgrade-icon">❤️</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Health Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.healthBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.healthBoost + 1) * 100} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="healthBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">⚔️</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Damage Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.damageBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.damageBoost + 1) * 150} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="damageBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">💨</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Speed Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.speedBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.speedBoost + 1) * 120} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="speedBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">🍀</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Luck Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.luckBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.luckBoost + 1) * 200} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="luckBoost">UPGRADE</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(upgradesModal);

    // Setup upgrade button handlers
    upgradesModal.querySelectorAll('.upgrade-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const upgradeType = (e.target as HTMLElement).dataset.upgrade as keyof PlayerProfile['permanentUpgrades'];
        this.purchaseUpgrade(upgradeType);
        upgradesModal.remove();
        this.showUpgrades(); // Refresh
      });
    });

    document.getElementById('close-upgrades')?.addEventListener('click', () => {
      upgradesModal.remove();
    });
  }

  private purchaseUpgrade(upgradeType: keyof PlayerProfile['permanentUpgrades']): void {
    const costs = { healthBoost: 100, damageBoost: 150, speedBoost: 120, luckBoost: 200 };
    const cost = (this.playerProfile.permanentUpgrades[upgradeType] + 1) * costs[upgradeType];
    
    if (this.playerProfile.currency >= cost) {
      this.playerProfile.currency -= cost;
      this.playerProfile.permanentUpgrades[upgradeType]++;
      this.savePlayerProfile();
      this.updateCurrencyDisplay();
    }
  }

  private showStatistics(): void {
    const statsModal = document.createElement('div');
    statsModal.className = 'cyberpunk-modal';
    statsModal.innerHTML = `
      <div class="modal-content stats-panel">
        <div class="modal-header">
          <h2>MISSION STATISTICS</h2>
          <button class="close-btn" id="close-stats">×</button>
        </div>
        <div class="stats-content">
          <h3>High Scores</h3>
          ${Object.entries(this.playerProfile.highScores).map(([char, score]) => 
            `<div class="score-item">${char}: ${score}</div>`
          ).join('') || '<div class="no-scores">No scores yet</div>'}
        </div>
      </div>
    `;

    document.body.appendChild(statsModal);
    document.getElementById('close-stats')?.addEventListener('click', () => {
      statsModal.remove();
    });
  }

  private updateCharacterPreview(characterData: any): void {
    const previewPortrait = document.getElementById('preview-portrait')?.querySelector('img') as HTMLImageElement;
    const previewName = document.getElementById('preview-name');
    const previewStats = document.getElementById('preview-stats');

    if (previewPortrait) previewPortrait.src = characterData.icon;
    if (previewName) previewName.textContent = characterData.name;
    if (previewStats) {
      previewStats.innerHTML = `
        <div class="stat-item">
          <span class="stat-label">Health:</span>
          <span class="stat-value">${characterData.stats.hp + (this.playerProfile.permanentUpgrades.healthBoost * 10)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Damage:</span>
          <span class="stat-value">${characterData.stats.damage + (this.playerProfile.permanentUpgrades.damageBoost * 5)}</span>
        </div>
      `;
    }
  }

  /** Render weapon info blocks for current operative (weaponTypes list) */
  private renderWeaponInfo(): void {
    const container = document.getElementById('weapon-info-body');
    if (!container) return;
    const char = this.gameInstance.selectedCharacterData;
    if (!char) { container.innerHTML = '<div style="opacity:.6">Select an operative to view weapon loadout.</div>'; return; }
    const defaultType = char.defaultWeapon;
    const spec = WEAPON_SPECS[defaultType as keyof typeof WEAPON_SPECS];
    if (!spec) { container.innerHTML = '<div style="opacity:.6">No class weapon spec found.</div>'; return; }
    const lifetime = spec.lifetime ?? (spec.range && spec.speed ? (spec.range / spec.speed / 60).toFixed(2)+'s' : '—');
    const traits = spec.traits?.length ? `<div style='margin-top:4px;font-size:10px;opacity:.75'>Traits: ${spec.traits.map(t=>`<span style="margin-right:4px">${this.escapeHtml(t)}</span>`).join('')}</div>` : '';
    container.innerHTML = `<div class='weapon-block'>
      <div class='w-name'>${spec.name} <span style='font-weight:400;opacity:.55;font-size:10px'>&#x2022; class</span></div>
      <div class='w-desc'>${this.escapeHtml(spec.description||'No description')}</div>
      <div class='w-stats'>
        <span>DMG ${spec.damage}</span>
        <span>CD ${spec.cooldown}f</span>
        <span>SPD ${spec.speed}</span>
        <span>RANGE ${spec.range}</span>
        <span>LVL ${spec.maxLevel}</span>
        <span>LIFE ${lifetime}</span>
        ${spec.explosionRadius?`<span>AOE ${spec.explosionRadius}</span>`:''}
        ${spec.knockback?`<span>KB ${spec.knockback}</span>`:''}
      </div>
      ${traits}
    </div>`;
  }

  private updateCurrencyDisplay(): void {
    const currencyEl = document.getElementById('currency-amount');
    if (currencyEl) currencyEl.textContent = this.playerProfile.currency.toString();
  }

  /** Renders the structured patch notes history into the patch notes panel. */
  private renderPatchNotes(): void {
    const body = document.getElementById('patch-notes-body');
    if (!body) return;
    // Render all versions newest-first; keep panel scrollable
    const htmlParts: string[] = [];
    for (let i = 0; i < this.patchNotesHistory.length; i++) {
      const v = this.patchNotesHistory[i];
      htmlParts.push(`<div class="pn-version"><span>${v.version}</span><span class="date">${v.date}</span></div>`);
      for (const e of v.entries) {
        const tagClass = e.tag.toLowerCase();
        htmlParts.push(`<div class="pn-entry"><span class="pn-tag ${tagClass}">${e.tag}</span>${this.escapeHtml(e.text)}</div>`);
      }
    }
    body.innerHTML = htmlParts.join('');
  }

  /** Resolve a human-friendly operative name from an id (fallback to id) */
  private opName(id?: string): string {
    if (!id) return '-';
    const c = CHARACTERS.find(ch => ch.id === id);
    return c?.name || id;
  }

  /** Compare two semantic version strings a vs b returning positive if a>b */
  private semanticCompare(a:string,b:string): number {
    const pa = a.split('.').map(n=>parseInt(n,10));
    const pb = b.split('.').map(n=>parseInt(n,10));
    for (let i=0;i<Math.max(pa.length,pb.length);i++) {
      const da = pa[i]||0, db = pb[i]||0;
      if (da!==db) return da-db;
    }
    return 0;
  }

  /** Basic HTML escape for user-visible patch note text safety */
  private escapeHtml(s:string): string {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'} as any)[c]||c);
  }

  private updateAuthUI(): void {
    const loginBtn = document.getElementById('login-btn');
    const authProfile = document.getElementById('auth-profile');
    const avatar = document.getElementById('auth-avatar') as HTMLImageElement | null;
    const nameEl = document.getElementById('auth-name');
    const emailEl = document.getElementById('auth-email');
  const statusLine = document.querySelector('.mm-footer .status-line') as HTMLElement | null;
    if (!loginBtn || !authProfile) return;
    if (this.authUser) {
    // Hide login button explicitly and show profile
    (loginBtn as HTMLElement).style.display = 'none';
    loginBtn.classList.add('hidden-init');
    authProfile.classList.remove('hidden-init');
    (authProfile as HTMLElement).style.display = 'flex';
      if (avatar) avatar.src = this.authUser.picture || 'https://www.gravatar.com/avatar/?d=mp';
      if (nameEl) nameEl.textContent = this.authUser.nickname || this.authUser.name;
      if (emailEl) emailEl.textContent = this.authUser.email;
      // If profile incomplete prompt for nickname
      if (!this.authUser.profileComplete) {
        this.showNicknameModal();
      }
      if (statusLine) {
        statusLine.classList.remove('offline');
        statusLine.classList.add('online');
        statusLine.innerHTML = '<span class="status-dot"></span>NEURAL LINK ONLINE';
      }
    } else {
  authProfile.classList.add('hidden-init');
  (authProfile as HTMLElement).style.display = 'none';
  (loginBtn as HTMLElement).style.display = 'inline-flex';
  loginBtn.classList.remove('hidden-init');
      if (statusLine) {
        statusLine.classList.remove('online');
        statusLine.classList.add('offline');
        statusLine.innerHTML = '<span class="status-dot"></span>NEURAL LINK OFFLINE';
      }
    }
  }
  private async refreshHighScores(silent:boolean=false): Promise<void> {
    const remotePanel = document.getElementById('hs-remote-board');
    if (!remotePanel) return;
    if (!isLeaderboardConfigured()) {
      if (!silent) remotePanel.innerHTML = '<div class="hs-empty">Leaderboard not configured</div>';
      return;
    }
  const selectedOp = (document.getElementById('hs-op-select') as HTMLSelectElement | null)?.value || '';
    const modeSelect = document.getElementById('game-mode-select') as HTMLSelectElement | null;
    const mode = modeSelect?.value || 'SHOWDOWN';
    const titleEl = document.getElementById('hs-title');
    if (titleEl) titleEl.textContent = 'HIGHSCORES';
  if (!silent && !remotePanel.hasAttribute('data-hash')) remotePanel.innerHTML = '<div class="hs-empty">Loading…</div>';
    try {
  const target = this.currentBoard;
  const { board } = resolveBoard(target);
  const finalBoard = selectedOp ? `${board}:op:${selectedOp}` : board;
      // Try snapshot immediately for responsive feel
      if (!silent && !remotePanel.hasAttribute('data-hash')) {
  const snap = loadSnapshot(finalBoard, 10, 0) || loadSnapshot(board, 10, 0);
        if (snap) {
          const fmtS = (t:number)=>`${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
          const snapHtml = `<div class='hs-table'>
            <div class='hs-row hs-head'>
              <span class='hs-cell rank'>#</span>
              <span class='hs-cell nick'>NAME</span>
        <span class='hs-cell op'>OPERATIVE</span>
              <span class='hs-cell time'>TIME</span>
              <span class='hs-cell kills'>Kills</span>
              <span class='hs-cell lvl'>Lv</span>
              <span class='hs-cell dps'>DPS</span>
      </div>` + snap.map((e,i)=>`<div class='hs-row data'>
              <span class='hs-cell rank'>${i+1}</span>
              <span class='hs-cell nick'>${sanitizeName(e.name)}</span>
    <span class='hs-cell op'>${this.opName((e as any).characterId)}</span>
              <span class='hs-cell time'>${fmtS(e.timeSec)}</span>
              <span class='hs-cell kills'>${e.kills??'-'}</span>
              <span class='hs-cell lvl'>${e.level??'-'}</span>
              <span class='hs-cell dps'>-</span>
            </div>`).join('') + '</div>';
          remotePanel.innerHTML = snapHtml;
        }
      }
  const top = await fetchTop(finalBoard, 10, 0).catch(()=>fetchTop(board,10,0));
  // Enforce descending ordering by timeSec (defensive if backend ever returns unsorted)
  const sorted = [...top].sort((a,b)=> (b.timeSec||0) - (a.timeSec||0));
  this.incrementalEntries = sorted;
      const me = this.playerId;
      const fmt = (t:number)=>{
        const m=Math.floor(t/60).toString().padStart(2,'0');
        const s=(t%60).toString().padStart(2,'0');
        return m+':'+s;
      };
  if (sorted.length) {
    const header = `<div class='hs-table'>
          <div class='hs-row hs-head'>
            <span class='hs-cell rank'>#</span>
            <span class='hs-cell nick'>NAME</span>
      <span class='hs-cell op'>OPERATIVE</span>
            <span class='hs-cell time'>TIME</span>
            <span class='hs-cell kills'>Kills</span>
            <span class='hs-cell lvl'>Lv</span>
            <span class='hs-cell dps'>DPS</span>
          </div>`;
          const bodyHtml = sorted.map((e,i) => {
          const timeSec = e.timeSec || 1;
          const kills = e.kills ?? 0;
          // Approx DPS estimation: (kills * avgDamagePerKill) / time; assume 50 dmg per kill fallback
          const estDps = Math.round((kills * 50) / timeSec);
          return `<div class='hs-row data ${e.playerId===me?'me':''}'>
            <span class='hs-cell rank'>${i+1}</span>
            <span class='hs-cell nick'>${sanitizeName(e.name)}</span>
            <span class='hs-cell op'>${this.opName((e as any).characterId)}</span>
            <span class='hs-cell time'>${fmt(e.timeSec)}</span>
            <span class='hs-cell kills'>${kills}</span>
            <span class='hs-cell lvl'>${e.level ?? '-'}</span>
            <span class='hs-cell dps'>${isFinite(estDps)?estDps:'-'}</span>
          </div>`;}).join('');
        let tableHtml = header + bodyHtml + '</div>';
        // If I'm not in visible list, append my row (will be appended again later if not careful)
        // We'll defer own-rank fetch below to preserve accuracy, not here.
        const newHtml = tableHtml; // already closed
  const hash = `${selectedOp||'all'}|` + sorted.map(e=>`${e.playerId}:${e.timeSec}:${e.kills}:${e.level}`).join('|');
        const prevHash = (remotePanel as HTMLElement).getAttribute('data-hash');
        if (prevHash !== hash) {
          remotePanel.innerHTML = newHtml;
          remotePanel.setAttribute('data-hash', hash);
        }
        // If I'm not in the visible list, append own real rank from backend (may be >10)
    if (!sorted.some(e=>e.playerId===me)) {
          try {
      const meEntry = await fetchPlayerEntry(finalBoard, me) || await fetchPlayerEntry(board, me); // uses backend rank ordering
            if (meEntry && meEntry.rank > 10) {
              const timeSec = meEntry.timeSec || 1;
              const kills = meEntry.kills ?? 0;
              const estDps = Math.round((kills * 50) / timeSec);
              // Append inside existing table just before closing tag
              const table = remotePanel.querySelector('.hs-table');
              if (table) {
                (table as HTMLElement).insertAdjacentHTML('beforeend', `<div class='hs-row data me'>
                <span class='hs-cell rank'>${meEntry.rank}</span>
                <span class='hs-cell nick'>${sanitizeName(meEntry.name)}</span>
                <span class='hs-cell op'>${this.opName(meEntry.characterId)}</span>
                <span class='hs-cell time'>${fmt(meEntry.timeSec)}</span>
                <span class='hs-cell kills'>${kills}</span>
                <span class='hs-cell lvl'>${meEntry.level ?? '-'}</span>
                <span class='hs-cell dps'>${isFinite(estDps)?estDps:'-'}</span>
              </div>`);
              }
            }
          } catch {/* ignore own-rank errors */}
        }
      } else {
        if (!silent) remotePanel.innerHTML = '<div class="hs-empty">No times.</div>';
      }
    } catch (err) {
      if (!silent) remotePanel.innerHTML = '<div class="hs-empty">Error loading.</div>';
    }
  }

  private async renderHighScoreList(mode:string, characterId:string) {
    const remotePanel = document.getElementById('hs-remote-board');
    if (!remotePanel) return;
    let html = '';
  html = '<div class="hs-empty">(No local storage scoreboard)</div>';
  // Remote rank/around removed
    remotePanel.innerHTML = html;
  }

  private showNicknameModal(): void {
    // Avoid duplicates
    if (document.getElementById('nickname-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'nickname-modal';
    modal.className = 'cyberpunk-modal';
    const suggested = this.authUser?.nickname || 'CyberOperative';
    modal.innerHTML = `
      <div class="modal-content nickname-panel">
        <div class="modal-header">
          <h2>CREATE HANDLE</h2>
          <button class="close-btn" id="close-nick">×</button>
        </div>
        <div class="nickname-body">
          <p>Select a unique cyber handle. This will identify you on leaderboards later.</p>
          <input id="nickname-input" class="nickname-input" maxlength="24" value="${suggested}" />
          <div class="nickname-actions">
            <button id="nickname-reroll" class="cyberpunk-btn secondary-btn small-btn">REROLL</button>
            <button id="nickname-save" class="cyberpunk-btn primary-btn small-btn">SAVE</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    import('../auth/NicknameGenerator').then(mod => {
      const input = document.getElementById('nickname-input') as HTMLInputElement | null;
      document.getElementById('nickname-reroll')?.addEventListener('click', () => {
        if (input) input.value = mod.generateNickname();
      });
    }).catch(()=>{});
    const saveBtn = document.getElementById('nickname-save') as HTMLButtonElement | null;
    const input = document.getElementById('nickname-input') as HTMLInputElement | null;
    const validate = async () => {
      if (!saveBtn || !input) return;
      const proposed = sanitizeName(input.value);
      if (!proposed) { saveBtn.disabled = true; return; }
      try {
        const ok = await isNicknameAvailable(proposed, this.playerId);
        saveBtn.disabled = !ok;
        saveBtn.textContent = ok ? 'SAVE' : 'NAME TAKEN';
      } catch { saveBtn.disabled = false; }
    };
    if (input) {
      input.addEventListener('input', () => { validate(); });
      // initial
      validate();
    }
    saveBtn?.addEventListener('click', () => this.saveNickname());
    document.getElementById('close-nick')?.addEventListener('click', () => modal.remove());
  }

  private saveNickname(): void {
    const input = document.getElementById('nickname-input') as HTMLInputElement | null;
    if (!input) return;
    // Require sign-in to change nickname
    if (!this.authUser) { googleAuthService.openLogin().catch(()=>{}); return; }
    const val = sanitizeName(input.value);
    if (!val) return;
  // Use statically imported googleAuthService (avoid dynamic import causing Vite warning)
  googleAuthService.setNickname(val);
  const modal = document.getElementById('nickname-modal');
  if (modal) modal.remove();
  // Claim nickname (enforces uniqueness) then refresh UI/HS
  (async()=>{
    const pid = this.authUser?.id || getPlayerId();
    const ok = await claimNickname(pid, val);
    if (!ok) {
      // fallback: notify and reopen modal
      alert('That handle is already taken. Please choose another.');
      this.showNicknameModal();
      return;
    }
    invalidateLeaderboardCache();
    this.updateAuthUI();
    this.refreshHighScores(true);
  })();
  }

  private initializeMatrix(): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    canvas.style.opacity = '0.1';

    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const matrixChars = '01アカサタナハマヤラワ'.split('');
    const fontSize = 10;
    const columns = canvas.width / fontSize;
    const drops: number[] = Array(Math.floor(columns)).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#0F3';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = matrixChars[Math.floor(Math.random() * matrixChars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    setInterval(draw, 35);
  }

  public show(): void {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'flex';
      this.updateCurrencyDisplay();
  // Refresh highscores on each menu show
  this.refreshHighScores();
    }
  matrixBackground.start();
  const soundPanel = document.getElementById('sound-settings-panel');
    if (soundPanel) {
      soundPanel.style.display = 'block';
    } else {
      // Lazy load original floating sound settings panel (main menu only)
      import('./SoundSettingsPanel').then(mod => {
        try {
          const panel = new mod.SoundSettingsPanel();
          panel.show();
        } catch { /* ignore */ }
      }).catch(()=>{/* ignore */});
    }
  }

  public hide(): void {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'none';
    }
  matrixBackground.stop();
  const soundPanel = document.getElementById('sound-settings-panel');
  if (soundPanel) soundPanel.style.display = 'none';
  }

  public updateScore(characterId: string, score: number): void {
    if (!this.playerProfile.highScores[characterId] || score > this.playerProfile.highScores[characterId]) {
      this.playerProfile.highScores[characterId] = score;
      this.savePlayerProfile();
    }
  }

  public getPermanentUpgrades(): PlayerProfile['permanentUpgrades'] {
    return this.playerProfile.permanentUpgrades;
  }

  public addCurrency(amount: number): void {
    this.playerProfile.currency += amount;
    this.savePlayerProfile();
    this.updateCurrencyDisplay();
  }

  public getMainMenuElement(): HTMLElement | null {
    return this.mainMenuElement;
  }

  public drawMatrixBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // Matrix background is now handled by initializeMatrix() method
    // This method is kept for compatibility but does nothing since we have canvas-based matrix
  }
}
