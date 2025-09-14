// Entry point for the game
import { Game } from './game/Game';
// Ensure Codex v2 Tailwind styles are always loaded in dev/prod
import './features/codex/styles.css';
import { createGLEnemyRendererLike } from './render/gl/GLEnemyRenderer';
import { MainMenu } from './ui/MainMenu';
import { CharacterSelectPanel } from './ui/CharacterSelectPanel'; // Import CharacterSelectPanel
import { AssetLoader } from './game/AssetLoader';
import { Logger } from './core/Logger'; // Import Logger
import { PreloadManager } from './game/PreloadManager';
import { GPUPrewarm } from './game/GPUPrewarm';
import { showGPUOverlay } from './ui/GPUOverlay';
import { ensurePauseOverlay } from './ui/PauseOverlay';
import { ensureGameOverOverlay } from './ui/GameOverOverlay';
import { ensureSandboxOverlay } from './ui/SandboxOverlay';
import { ensureRadioOverlay } from './ui/RadioOverlay';

/** Lightweight frame snapshot for worker (packed minimal fields). */
interface WorkerFrame {
  camX:number; camY:number; scale:number;
  player?: { x:number; y:number; r:number };
  enemies: { x:number; y:number; r:number; hp:number; max:number }[];
  bullets: { x:number; y:number; r:number }[];
}

function applyCanvasSizeGlobal(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

window.onload = async () => {
  // Lightweight loading overlay for slow connections
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-overlay';
  loadingDiv.style.position = 'fixed';
  loadingDiv.style.inset = '0';
  loadingDiv.style.background = 'radial-gradient(circle at 50% 40%, #062025 0%, #020a0c 80%)';
  loadingDiv.style.display = 'flex';
  loadingDiv.style.flexDirection = 'column';
  loadingDiv.style.alignItems = 'center';
  loadingDiv.style.justifyContent = 'center';
  loadingDiv.style.font = '600 18px Orbitron, sans-serif';
  loadingDiv.style.color = '#26ffe9';
  loadingDiv.style.letterSpacing = '1px';
  loadingDiv.style.zIndex = '9999';
  loadingDiv.innerHTML = `<div style="margin-bottom:18px;font-size:28px;text-shadow:0 0 12px #00ffc8">CYBERSURVIVOR</div>
    <div id="load-bar" style="width:320px;height:14px;outline:1px solid #0aa;position:relative;background:rgba(0,40,48,0.5);overflow:hidden">
      <div id="load-bar-fill" style="position:absolute;left:0;top:0;height:100%;width:0;background:linear-gradient(90deg,#26ffe9,#00b3a3);"></div>
    </div>
  <div id="load-status" style="margin-top:10px;font-size:12px;color:#9fe;opacity:0.85">Initializing...</div>`;
  document.body.appendChild(loadingDiv);

  function updateLoading(progress:number, label:string){
    const fill = document.getElementById('load-bar-fill') as HTMLDivElement | null;
    const status = document.getElementById('load-status');
    if (fill) fill.style.width = Math.min(100, Math.round(progress*100)) + '%';
    if (status) status.textContent = label;
  }
  function hideLoadingOverlay(immediate=false){
    const ov = document.getElementById('loading-overlay');
    if (!ov) return;
    if (immediate){ ov.remove(); return; }
    ov.setAttribute('data-hide','1');
    ov.style.transition='opacity 0.55s';
    ov.style.opacity='0';
    setTimeout(()=>{ if (ov && ov.parentNode) ov.remove(); }, 650);
  }
  // Hold overlay until fonts are ready (prevents font swap during loading)
  try {
    const fr: Promise<any> | undefined = (window as any).__fontsReadyPromise;
    if (fr && typeof (fr as any).then === 'function') {
      // Also add a short timeout fallback so we never block too long on slow font loads
      const timeout = new Promise(res => setTimeout(res, 2500));
      Promise.race([fr, timeout]).then(() => {
        // allow hide later when game is ready
      }).catch(()=>{/* ignore */});
    }
  } catch {}
  // Absolute safety fallback: force remove after 12s even if something broke earlier
  setTimeout(()=> hideLoadingOverlay(false), 12000);

  // Electron preload integration removed – no runtime preload validation needed.
  // --- Cinematic skip button click handler ---
  // Move click handler after canvas is assigned
  setTimeout(() => {
    canvas.addEventListener('mousedown', (e) => {
      if (!game.cinematic || !game.cinematic.active) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cinematicAny = game.cinematic as any;
      if (cinematicAny && typeof cinematicAny.handleClick === 'function' && cinematicAny.handleClick(x, y, canvas)) {
        Logger.info('[main.ts] Cinematic skipped via button');
      }
    });
  }, 0);
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) {
    Logger.error('Canvas element with ID "gameCanvas" not found.');
    return;
  }

  canvas.classList.add('game-canvas-root');
  applyCanvasSizeGlobal(canvas);

  // Optional GL bullets renderer toggle via URL (?gl=1)
  const glEnabled = /[?&]gl=1/.test(location.search);
  (window as any).__glEnabled = glEnabled;
  if (glEnabled) {
    try {
      const mod = await import('./render/gl/GLBulletRenderer');
      const glr = mod.createGLBulletRendererLike(canvas);
      (window as any).__glBulletRenderer = glr;
    } catch (e) {
      (window as any).__glEnabled = false;
      (window as any).__glBulletRenderer = null;
      console.warn('[main] GL bullets init failed, will use 2D path', e);
    }
  }

  // Optional GL enemies renderer via URL (?gle=1) or persisted preference
  let glEnemiesEnabled = /[?&]gle=1/.test(location.search);
  try {
    if (!glEnemiesEnabled) {
      const saved = localStorage.getItem('cs-gl-enemies');
      if (saved === '1') glEnemiesEnabled = true;
    }
  } catch { /* ignore storage */ }
  (window as any).__glEnemiesEnabled = glEnemiesEnabled;
  if (glEnemiesEnabled) {
    try {
      const glER = createGLEnemyRendererLike(canvas);
      if (glER) {
        (window as any).__glEnemiesRenderer = glER;
      } else {
        (window as any).__glEnemiesEnabled = false;
      }
    } catch (e) {
      (window as any).__glEnemiesEnabled = false;
      (window as any).__glEnemiesRenderer = null;
      console.warn('[main] GL enemies init failed, using 2D path', e);
    }
  }
  // Keyboard runtime toggle: Ctrl+G -> toggle GL enemies
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'g' && e.key !== 'G')) return;
    e.preventDefault();
    const currently = !!(window as any).__glEnemiesEnabled;
    const next = !currently;
    (window as any).__glEnemiesEnabled = next;
    try { localStorage.setItem('cs-gl-enemies', next ? '1' : '0'); } catch {}
    if (next && !(window as any).__glEnemiesRenderer) {
      try {
        const glER = createGLEnemyRendererLike(canvas);
        if (glER) (window as any).__glEnemiesRenderer = glER;
        else (window as any).__glEnemiesEnabled = false;
      } catch {
        (window as any).__glEnemiesEnabled = false;
      }
    }
    if (!next) {
      // Drop reference to allow GC; 2D path resumes automatically
      try { (window as any).__glEnemiesRenderer = null; } catch {}
    }
  });

  const game = new Game(canvas); // Instantiate Game first
  (window as any).__game = game; // expose for resize handling
  (window as any).__gameInstance = game; // ensure global reference for Cinematic skip
  (window as any).__cinematicInstance = game.cinematic; // ensure global reference for ESC handler
  // --- Mouse position to world coordinates for anchor ability ---
  const mouseState = (window as any).mouseState || {};
  (window as any).mouseState = mouseState;
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Get camera position from game
    const camX = (game as any).camX ?? 0;
    const camY = (game as any).camY ?? 0;
    const world = (window as any).screenToWorld ? (window as any).screenToWorld(sx, sy, camX, camY) : { x: sx + camX, y: sy + camY };
    mouseState.worldX = world.x;
    mouseState.worldY = world.y;
  });
  // Experimental Offscreen worker DISABLED for now (caused start-game stutter due to large postMessage payloads).
  // Leave scaffold for future refinement.
  // (window as any).__workerRender = false;
  // FPS & performance overlays removed; HUD now renders in-canvas FPS.

  // --- Optional Offscreen worker renderer (enable via ?worker=1) ---
  const useWorker = /[?&]worker=1/.test(location.search) && (window as any).OffscreenCanvas;
  let worker: Worker | null = null;
  if (useWorker) {
    try {
      worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen, width: canvas.width, height: canvas.height }, [offscreen]);
      // Hook after in-thread render logic to send snapshot (very lightweight arrays)
      (game as any).gameLoop?.setRenderHook?.(() => {
        // Build compact snapshot without allocating large new arrays each frame
        const enemiesSrc = game.getEnemyManager().getEnemies();
        const bulletsSrc = game.getBulletManager().bullets;
        const eLen = enemiesSrc.length;
        const bLen = bulletsSrc.length;
        const enemies: WorkerFrame['enemies'] = new Array(eLen);
        for (let i=0;i<eLen;i++) {
          const e:any = enemiesSrc[i];
          enemies[i] = { x:e.x, y:e.y, r:e.radius, hp:e.hp, max:e.maxHp };
        }
        const bullets: WorkerFrame['bullets'] = new Array(bLen);
        for (let i=0;i<bLen;i++) {
          const b:any = bulletsSrc[i];
          bullets[i] = { x:b.x, y:b.y, r:b.radius };
        }
        const frame: WorkerFrame = {
          camX: (game as any).camX ?? 0,
          camY: (game as any).camY ?? 0,
          scale: 1,
          player: { x: game.player.x, y: game.player.y, r: game.player.radius },
          enemies,
          bullets
        };
        worker?.postMessage({ type:'frame', payload: frame });
      });
    } catch (err) {
      console.warn('[main] Worker init failed, reverting to main-thread render', err);
    }
  }
  const mainMenu = new MainMenu(game); // Pass game instance to MainMenu
  // Instantiate pause overlay immediately so Escape can show it right away
  const pauseOverlay = ensurePauseOverlay(game);
  // Instantiate game over overlay early so event will show it instantly
  const gameOverOverlay = ensureGameOverOverlay(game);
  // Instantiate sandbox overlay helper (lazy show only in SANDBOX)
  const sandboxOverlay = ensureSandboxOverlay(game);
  // Instantiate radio overlay (hidden by default)
  const radioOverlay = ensureRadioOverlay();
  // Auto-aim: initialize from persisted setting and expose globally
  try {
    const savedAim = localStorage.getItem('cs-aimMode');
    const initialAim = (savedAim === 'toughest' || savedAim === 'closest') ? savedAim : 'closest';
    (window as any).__aimMode = initialAim;
    (game as any).aimMode = initialAim;
  } catch { (window as any).__aimMode = 'closest'; (game as any).aimMode = 'closest'; }
  // Robust capture-phase ESC handler (prevents race conditions / missed pause)
  let escToggleGuard = 0; // timestamp of last ESC handling
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Block pause if Cinematic is active
    if ((window as any).__cinematicInstance?.active) return;
    // Basic debounce (~75ms) to avoid double toggle from multiple listeners
    const now = performance.now();
    if (now - escToggleGuard < 75) return;
    escToggleGuard = now;
    const st = game.getState ? game.getState() : (game as any).state;
    if (st === 'GAME') {
      e.preventDefault();
      game.pause();
    } else if (st === 'PAUSE') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('resumeGame'));
    }
  }, true); // capture phase so it runs before other handlers
  // Auto-aim toggle (C) is now restricted to active gameplay; see Game.initInput handler.
  // Gate showing the pause overlay strictly to when the internal state is PAUSE
  window.addEventListener('showPauseOverlay', (e: Event) => {
    const st = game.getState ? game.getState() : (game as any).state;
    if (st !== 'PAUSE') {
      Logger.warn('[main.ts] showPauseOverlay ignored, state =', st);
      return; // Prevent showing before gameplay has started
    }
    const detail = (e as CustomEvent).detail || {};
    pauseOverlay.show(!!detail.auto);
    Logger.info('[main.ts] Pause overlay shown (auto=' + (!!detail.auto) + ')');
  });

  // Sandbox helpers: press T to spawn 1 dummy, Shift+T to spawn 5; press Y to clear dummies
  window.addEventListener('keydown', (e) => {
    const gm = (game as any).gameMode;
    if (gm !== 'SANDBOX') return;
    const st = game.getState ? game.getState() : (game as any).state;
    if (st !== 'GAME') return;
    if (e.key === 't' || e.key === 'T') {
      const count = e.shiftKey ? 5 : 1;
      window.dispatchEvent(new CustomEvent('sandboxSpawnDummy', { detail: { count, radius: 32, hp: 5000 } }));
    } else if (e.key === 'y' || e.key === 'Y') {
      window.dispatchEvent(new CustomEvent('sandboxClearDummies'));
    } else if (e.key === 'o' || e.key === 'O') {
      // Open character select to switch operative mid-sandbox
      window.dispatchEvent(new CustomEvent('showCharacterSelect'));
    } else if (e.key === 'u' || e.key === 'U') {
      // Toggle sandbox overlay
      try { ensureSandboxOverlay(game).toggle(); } catch {}
    }
  });
  window.addEventListener('hidePauseOverlay', () => pauseOverlay.hide());

  // Now pass UI panels to game after they are instantiated
  game.setMainMenu(mainMenu);

  // Initial state setup
  game.setState('MAIN_MENU');
  Logger.info('[main.ts] Initial state set to MAIN_MENU');

  try {
    // Centralized preload: images, audio primes, and effects video
    await PreloadManager.preloadAll((game as any).assetLoader, (p, label) => updateLoading(p, label));
    // Initialize systems after all assets are primed for best first-frame stability
    updateLoading(0.94, 'Initializing systems');
    await game.init();
    // GPU warm-up to minimize first draw hitch
  GPUPrewarm.prewarm(canvas);
  if (/[?&]gpu=1/.test(location.search)) showGPUOverlay();
    Logger.info('[main.ts] Preload complete');
  } catch (fatal) {
  updateLoading(1, 'Loading error');
    Logger.error('[main.ts] Fatální chyba během načítání', fatal);
    // Provide basic retry button
    const status = document.getElementById('load-status');
    if (status){
      const btn = document.createElement('button');
      btn.textContent = 'Reload';
      btn.style.marginTop='12px';
      btn.onclick=()=> location.reload();
      status.appendChild(btn);
    }
  }
  // Enable variable timestep mode (systems now scale by delta). Can disable via console: __game.gameLoop.setVariableTimestep(false)
  (game as any).gameLoop?.setVariableTimestep?.(true);

  // Manifest already loaded inside game.init() via loadAllFromManifest; avoid redundant second fetch.

  // Instantiate CharacterSelectPanel after assets are loaded
  const characterSelectPanel = new CharacterSelectPanel();
  game.setCharacterSelectPanel(characterSelectPanel);
  // Codex: React Codex v2 is the only implementation now
  const codexV2 = (window as any).__codex2Enabled === true;

  // Instantiate UpgradePanel after player is initialized
  import('./ui/UpgradePanel').then(({ UpgradePanel }) => {
    const upgradePanel = new UpgradePanel(game.player, game);
    game.setUpgradePanel(upgradePanel);
    Logger.info('[main.ts] UpgradePanel instantiated and set.');
  });

  // Preload background music for legacy path (skipped if radio enabled)
  import('./game/SoundManager').then(({ SoundManager }) => {
  if ((window as any).__radioEnabled) return; // Radio will handle its own audio
  const musicPathInit = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/music/bg-music.mp3') : (location.protocol==='file:'?'./assets/music/bg-music.mp3':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/music/bg-music.mp3':'/assets/music/bg-music.mp3'));
    SoundManager.preloadMusic(musicPathInit);
    // Also arm early start: first user gesture (click / key) in main menu triggers playback.
    // This keeps autoplay policy compliant while giving ambience before gameplay.
    const earlyHandler = () => {
      if (!musicStarted) startMusic(false);
      window.removeEventListener('pointerdown', earlyHandler);
      window.removeEventListener('keydown', earlyHandler);
    };
    window.addEventListener('pointerdown', earlyHandler, { once: true });
    window.addEventListener('keydown', earlyHandler, { once: true });
  });

  game.start();
  Logger.info('[main.ts] Game loop started');
  // Fade out loading overlay
  setTimeout(()=>{ updateLoading(1,'Finalizing...'); hideLoadingOverlay(false); }, 150);
  // Also hide immediately once first main menu frame is shown
  requestAnimationFrame(()=> requestAnimationFrame(()=> hideLoadingOverlay(false)));

  // Responsive resize: adjust canvas + game logical size on window resize
  const handleResize = () => {
    applyCanvasSizeGlobal(canvas);
    game.resize(window.innerWidth, window.innerHeight);
    try {
      const glr: any = (window as any).__glBulletRenderer;
      if (glr && typeof glr.setSize === 'function') {
        glr.setSize(canvas.width, canvas.height);
      }
    } catch { /* ignore */ }
    try {
      const glE: any = (window as any).__glEnemiesRenderer;
      if (glE && typeof glE.setSize === 'function') {
        glE.setSize(canvas.width, canvas.height);
      }
    } catch { /* ignore */ }
  };
  window.addEventListener('resize', handleResize);
  // In case of orientation change / zoom adjustments
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 50));

  // (Render hook removed while worker disabled.)

  mainMenu.show(); // Show the main menu initially
  Logger.info('[main.ts] Main menu shown');

  // F9: Run a 20s stress test (SHOWDOWN mode). Spawns dense waves, enables low VFX, and prints summary.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F9') return;
    const gm = (game as any).gameMode;
    if (gm !== 'SHOWDOWN' && gm !== 'SANDBOX') return;
    Logger.info('[perf] Stress test starting: spawning dense waves for 20s; enabling low VFX');
    // Enable global low VFX flag
    try { (window as any).__vfxLowMode = true; } catch {}
    // Spawn batches near player
    const player = game.player;
    const EM = game.getEnemyManager() as any;
    const start = performance.now();
    let spawned = 0;
    const spawnTick = () => {
      const now = performance.now();
      if (now - start > 20000) {
        // Stop and print summary
        try { (window as any).__vfxLowMode = false; } catch {}
        const fps = (window as any).__frameJitterP95;
        Logger.info('[perf] Stress test done. p95 frame delta = ' + fps + 'ms; enemies=' + EM.getEnemies()?.length + ' bullets=' + (game.getBulletManager() as any).bullets?.length);
        return;
      }
      const px = player.x, py = player.y;
      const ring = 480;
      for (let i=0;i<40;i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = ring + Math.random()*140;
        const x = px + Math.cos(ang) * r;
        const y = py + Math.sin(ang) * r;
        EM.spawnEnemyAt?.(x, y, { type: 'medium', hp: 120 });
        spawned++;
      }
      setTimeout(spawnTick, 250);
    };
    spawnTick();
  });

  // --- Sound Settings Panel & Music ---
  // Sound settings now only accessible via Pause -> Options; no auto panel on gameplay start
  // Hudba se spustí až po startu hry (po interakci uživatele)
  let musicStarted = false;
  function startMusic(forceReload = false) {
    if ((window as any).__radioEnabled) { musicStarted = true; return; }
    if (musicStarted && !forceReload) return;
    import('./game/SoundManager').then(({ SoundManager }) => {
  const musicPath = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/music/bg-music.mp3') : (location.protocol==='file:'?'./assets/music/bg-music.mp3':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/music/bg-music.mp3':'/assets/music/bg-music.mp3'));
      SoundManager.playMusic(musicPath, forceReload);
      Logger.info('[main.ts] Background music playMusic invoked (forceReload=' + forceReload + ')');
      musicStarted = true;
      // Fallback: if still not playing after 2s, attach one-shot gesture to force reload
      setTimeout(()=>{
        try {
          const sm: any = (SoundManager as any);
          // call debug
          (SoundManager as any).debugStatus?.();
          if ((SoundManager as any).bgMusic && !(SoundManager as any).bgMusic.playing()) {
            const forceHandler = () => {
              document.removeEventListener('pointerdown', forceHandler);
              document.removeEventListener('keydown', forceHandler);
              startMusic(true); // force reload with cache bust
            };
            document.addEventListener('pointerdown', forceHandler, { once:true });
            document.addEventListener('keydown', forceHandler, { once:true });
            Logger.warn('[main.ts] Music still not playing; waiting for user gesture to force reload.');
          }
        } catch {/* ignore */}
      }, 2000);
    });
  }

  window.addEventListener('startGame', (event: Event) => {
  // Hide legacy floating sound panel if it exists (now only inside pause overlay)
  const legacySound = document.getElementById('sound-settings-panel');
  if (legacySound) legacySound.style.display = 'none';
  startMusic(false); // play after user interaction
    const customEvent = event as CustomEvent;
    const payload: any = customEvent.detail;
    const selectedCharData = payload.character || payload; // backward compatibility
    if (payload.mode) {
      (game as any).gameMode = payload.mode;
      Logger.info('[main.ts] Game mode set to ' + payload.mode);
    }
    Logger.info('[main.ts] startGame event received, selectedCharData:', selectedCharData);
    game.resetGame(selectedCharData); // Reset game with selected character & mode
    mainMenu.hide();
    Logger.info('[main.ts] Main menu hidden, starting cinematic and game');
    // Ensure canvas is visible and on top
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
    game.startCinematicAndGame(); // Start cinematic and then game
  // Show in-game radio overlay near the minimap
  try { radioOverlay.show(); } catch {}
    // Auto-show sandbox overlay when launching SANDBOX and spawn a few targets
    if ((game as any).gameMode === 'SANDBOX') {
      try {
        // delay to ensure state advanced to GAME
        setTimeout(() => {
          // Ensure canvas is visible
          canvas.style.display = 'block';
          canvas.style.zIndex = '10';
          // Seed/refresh sandbox spawn pad near current operative at session start
          try { (window as any).__sandboxPad = { x: game.player.x, y: game.player.y - 140 }; } catch {}
          ensureSandboxOverlay(game).show();
          // Seed with one of each archetype for quick testing
          try { window.dispatchEvent(new CustomEvent('sandboxSpawnAllTypes')); } catch {}
        }, 0);
      } catch {}
    } else {
      try { ensureSandboxOverlay(game).hide(); } catch {}
    }
  });

  // If a character is selected while in Sandbox, immediately restart in Sandbox with the new operative
  window.addEventListener('characterSelected', (e: Event) => {
    const gm = (game as any).gameMode;
    if (gm !== 'SANDBOX') return; // normal flow handles non-sandbox
    const st = game.getState ? game.getState() : (game as any).state;
    // Allow switching from GAME or PAUSE
    const detail = (e as CustomEvent).detail;
    if (!detail) return;
    Logger.info('[main.ts] Sandbox operative switch -> restarting with new character');
    // Hide menu/selector and relaunch
    try { mainMenu.hide(); } catch {}
    try { (game as any).selectedCharacterData = detail; } catch {}
    (game as any).gameMode = 'SANDBOX';
    game.resetGame(detail); // Player.resetState clears weapons, Game wiring re-adds class default
    game.startCinematicAndGame();
  // Re-show radio overlay after restarting gameplay in Sandbox
  try { radioOverlay.show(); } catch {}
    // Re-show overlay after switching operatives (spawn a couple of targets again)
    try {
      setTimeout(() => {
        ensureSandboxOverlay(game).show();
        window.dispatchEvent(new CustomEvent('sandboxSpawnDummy', { detail: { count: 2, radius: 32, hp: 5000 } }));
      }, 0);
    } catch {}
  });

  window.addEventListener('showCharacterSelect', () => {
    Logger.info('[main.ts] showCharacterSelect -> redirect to Codex Operatives');
    mainMenu.hide();
    characterSelectPanel.hide();
    try { ensureSandboxOverlay(game).hide(); } catch {}
    try { radioOverlay.hide(); } catch {}
    // Let codex2 boot handle this via showCodex
    window.dispatchEvent(new CustomEvent('showCodex', { detail: { tab: 'operatives' } }));
    // Keep canvas behind UI for Codex
    canvas.style.zIndex = '-1';
  });

  window.addEventListener('showCodex', (e: Event) => {
    Logger.info('[main.ts] showCodex event received');
    // Keep main menu visible behind Codex so closing Codex never yields a blank screen.
    // mainMenu.hide();
    characterSelectPanel.hide();
    try { ensureSandboxOverlay(game).hide(); } catch {}
    const detail = (e as CustomEvent).detail as { tab?: string, operativeId?: string } | undefined;
    // Keep canvas behind to allow UI focus
    canvas.style.zIndex = '-1';
    // Hide radio overlay while Codex is open
    try { radioOverlay.hide(); } catch {}
  });

  window.addEventListener('hideCodex', () => {
    Logger.info('[main.ts] hideCodex event received');
  // Codex v2 will handle hide via its event listener
    // If in-game, re-show radio overlay upon leaving Codex
    try {
      const st = game.getState ? game.getState() : (game as any).state;
      if (st === 'GAME' || st === 'PAUSE') radioOverlay.show();
    } catch {}
    // Restore canvas layering so something is visible immediately
    try {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
      if (canvas) {
        canvas.style.display = 'block';
        // If Codex boot preserved previous z-index, it will restore it. Ensure a sane fallback.
        if (!canvas.style.zIndex || canvas.style.zIndex === '-1') {
          // If we're in menu state, keep canvas behind menus; otherwise bring above
          const st = game.getState ? game.getState() : (game as any).state;
          canvas.style.zIndex = (st === 'MAIN_MENU' || st === 'CHAR_SELECT') ? '-1' : '10';
        }
      }
    } catch {}
    // If we're in main menu state, make sure the main menu is visible again
    try {
      const st = game.getState ? game.getState() : (game as any).state;
      if (st === 'MAIN_MENU') {
        mainMenu.show();
      }
    } catch {}
  });

  window.addEventListener('showMainMenu', () => {
    Logger.info('[main.ts] showMainMenu event received');
  characterSelectPanel.hide(); // Hide character select if coming from there
  try { game.stopToMainMenu(); } catch {}
    mainMenu.show();
  // Codex v2 reacts to showMainMenu itself via listener
    canvas.style.zIndex = '-1';
  try { ensureSandboxOverlay(game).hide(); } catch {}
  try { radioOverlay.hide(); } catch {}
  // Clear sandbox pad on returning to menu to avoid stale positions after relaunch
  try { delete (window as any).__sandboxPad; } catch {}
  try { game.onReturnToMainMenu(); } catch { /* ignore if not yet defined */ }
  });

  window.addEventListener('backToMenu', () => {
    Logger.info('[main.ts] backToMenu event received');
    characterSelectPanel.hide();
    mainMenu.show();
    canvas.style.zIndex = '-1';
  try { ensureSandboxOverlay(game).hide(); } catch {}
  try { radioOverlay.hide(); } catch {}
  // Clear sandbox pad on manual back to menu
  try { delete (window as any).__sandboxPad; } catch {}
  });

  window.addEventListener('pauseGame', () => {
    Logger.info('[main.ts] pauseGame event received');
    game.pause(); // Game.pause() will emit showPauseOverlay only if state transitioned from GAME
  });

  window.addEventListener('resumeGame', () => {
    Logger.info('[main.ts] resumeGame event received');
    game.resume(); // Game.resume() emits hidePauseOverlay itself
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  // Ensure radio overlay is visible again when resuming gameplay
  try { radioOverlay.show(); } catch {}
  });

  // Show upgrade panel on player level up (not in Last Stand)
  window.addEventListener('levelup', () => {
    try {
      const g: any = (window as any).__game;
      if (g && g.gameMode === 'LAST_STAND') return;
    } catch {}
    Logger.info('[main.ts] levelup event received, dispatching showUpgradePanel');
    window.dispatchEvent(new CustomEvent('showUpgradePanel'));
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });
  // Matrix background now managed by MatrixBackground singleton (auto on show/hide)

  // Fallback Escape (kept minimal) if game listener not yet attached
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const g: any = (window as any).__game;
    if (!g) return;
    const st = g.getState ? g.getState() : g.state;
    if (st === 'GAME') g.pause();
    else if (st === 'PAUSE') window.dispatchEvent(new CustomEvent('resumeGame'));
    // Ignore in menus / character select / cinematic
  });
};

window.onresize = () => {
  const canvasEl = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
  if (canvasEl) applyCanvasSizeGlobal(canvasEl);
  const g = (window as any).__game as Game | undefined;
  if (g) g.resize(window.innerWidth, window.innerHeight);
};
