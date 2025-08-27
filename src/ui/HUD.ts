import { Player } from '../game/Player';
import { AssetLoader } from '../game/AssetLoader';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { Enemy } from '../game/EnemyManager'; // Import Enemy type

export class HUD {
  private player: Player;
  private loader: AssetLoader | null = null;
  public currentDPS: number = 0; // New property for DPS
  public maxDPS: number = 0; // Peak DPS this run
  public showMinimap: boolean = true; // Always on now
  private baseWorldW?: number; // freeze initial world size for minimap scale
  private baseWorldH?: number;

  constructor(player: Player, loader?: AssetLoader) {
    this.player = player;
    this.loader = loader || null;
  }

  public draw(ctx: CanvasRenderingContext2D, gameTime: number, enemies: Enemy[], worldW: number, worldH: number, upgrades: string[]) { // Added upgrades parameter
    // Convert from backing pixel size to logical design size (canvas scaled by dpr * renderScale in Game.render)
    const dpr = (window as any).devicePixelRatio || 1;
    const renderScale = (window as any).__renderScale || 1;
    const scale = dpr * renderScale;
    const width = ctx.canvas.width / scale;
    const height = ctx.canvas.height / scale;
    ctx.save();
    // Force neutral render state so leaked alpha/composite from gameplay layers can't fade UI
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    // --- THEME CONSTANTS ---
    const FONT_TITLE = 'bold 32px Orbitron, sans-serif';
    const FONT_SECTION = 'bold 18px Orbitron, sans-serif';
    const FONT_STAT = '14px Orbitron, sans-serif';
    const FONT_BODY = '12px Orbitron, sans-serif';
  // Updated theme palette (teal/cyan unified)
  const COLOR_CYAN = '#26ffe9'; // primary accent
  const COLOR_ACCENT_ALT = '#00b3a3'; // secondary accent
  const COLOR_ACCENT_DEEP = '#008b7d';
  const COLOR_BG_PANEL = 'rgba(6,14,18,0.55)';
  const COLOR_BG_PANEL_DEEP = 'rgba(10,20,26,0.82)';
  const COLOR_TEXT = '#e3fefb';
  const COLOR_TEXT_DIM = 'rgba(185,225,220,0.68)';
    ctx.imageSmoothingEnabled = true;

    // --- TIMER (center top) ---
    const minutes = Math.floor(gameTime / 60).toString().padStart(2, '0');
    const seconds = Math.floor(gameTime % 60).toString().padStart(2, '0');
    ctx.font = FONT_TITLE;
    ctx.textAlign = 'center';
    this.drawGlowText(ctx, `${minutes}:${seconds}`, width / 2, 46, COLOR_TEXT, COLOR_CYAN, 14);
    // Kill count (compact) under main timer
    try {
      const gameRef: any = (window as any).__gameInstance;
      const kills = gameRef?.getKillCount ? gameRef.getKillCount() : 0;
      ctx.font = 'bold 14px Orbitron, sans-serif';
      this.drawGlowText(ctx, `Kills ${kills}`, width / 2, 66, COLOR_TEXT_DIM, COLOR_ACCENT_ALT, 6);
    } catch { /* ignore */ }
  // We'll draw FPS later once minimap position vars are defined so it sits in the gap above minimap.

  // --- LEFT PANEL (Simplified Class Stats) ---
  const panelX = 14;
  const panelY = 14;
  // Match minimap width for consistent layout (minimap = 150)
  const minimapSize = 150;
  const panelW = minimapSize;
  // Class dominant color (fallback to cyan theme)
  const classAccent = (this.player as any)?.color || (this.player as any)?.characterData?.color || COLOR_CYAN;
  const simpleStats = this.getSimpleClassStats();
  const headerH = 58; // taller header to avoid overlap with first stat line
  const lineH = 24;   // more vertical spacing per stat row
  const panelH = headerH + (simpleStats.length * lineH) + 16;
  this.drawPanelThemed(ctx, panelX, panelY, panelW, panelH, classAccent, () => {
    ctx.save();
  // Header: Class name (fitted) + Level
  ctx.textAlign = 'left';
  const name = (this.player as any)?.characterData?.name || 'OPERATIVE';
  // Fit class name into panel width with dynamic font size and ellipsis
  const headerMaxW = panelW - 24; // padding 12 on both sides
  const fitted = this.fitTextToWidth(ctx, name, headerMaxW, 18, 12);
  ctx.font = `bold ${fitted.fontSize}px Orbitron, sans-serif`;
  this.drawGlowText(ctx, fitted.text, panelX + 12, panelY + 26, COLOR_TEXT, classAccent, 6);
  // Level line (smaller, typically fits)
  ctx.font = 'bold 14px Orbitron, sans-serif';
  const lvlText = `LEVEL ${this.player.level}`;
  // If needed, also clamp level text just in case of extreme locales/fonts
  const lvlF = this.fitTextToWidth(ctx, lvlText, headerMaxW, 14, 11);
  ctx.font = `bold ${lvlF.fontSize}px Orbitron, sans-serif`;
  this.drawGlowText(ctx, lvlF.text, panelX + 12, panelY + 50, COLOR_TEXT_DIM, classAccent, 4);

    // Stats list (labels left, values right, accented by class color)
  ctx.font = FONT_STAT;
  let y = panelY + headerH + 6; // extra breathing room below header
    for (let i = 0; i < simpleStats.length; i++) {
      const [label, value] = simpleStats[i];
      ctx.fillStyle = COLOR_TEXT_DIM;
      ctx.textAlign = 'left';
      ctx.fillText(label + ':', panelX + 10, y);
      ctx.fillStyle = classAccent;
      ctx.textAlign = 'right';
      ctx.fillText(value, panelX + panelW - 10, y);
      y += lineH;
    }
    ctx.restore();
  });

    // HP Bar
    const hpBarY = height - 64;
    const hpBarWidth = Math.min(480, width - 320);
  this.drawThemedBar(ctx, 20, hpBarY, hpBarWidth, 22, this.player.hp / this.player.maxHp, '#fe2740', '#4a0910', COLOR_ACCENT_ALT, `HP ${Math.floor(this.player.hp)}/${Math.floor(this.player.maxHp)}`);

    // Class-specific bar(s): Scrap only for Scavenger, Tech only for Tech Warrior
    try {
      const id = (this.player as any)?.characterData?.id;
      const classX = 20 + hpBarWidth + 16;
      const maxW = Math.min(280, Math.max(120, width - (classX + 40)));
      if (id === 'wasteland_scavenger' && (this.player as any).getScrapMeter) {
        const meter: any = (this.player as any).getScrapMeter();
        const ratio = meter.max > 0 ? meter.value / meter.max : 0;
        const label = `SCRAP ${meter.value}/${meter.max}`;
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#f0b400', '#3a2a00', '#ffaa00', label);
      } else if (id === 'tech_warrior' && (this.player as any).getTechMeter) {
        const meter: any = (this.player as any).getTechMeter();
        const ratio = meter.max > 0 ? meter.value / meter.max : 0;
        const label = `TACHYON ${meter.value}/${meter.max}`;
        // Red theme for Tech Warrior meter
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#ff3b3b', '#3a0000', '#e60012', label);
        // Second bar: Glide Dash cooldown/active state (Shift)
        if ((this.player as any).getTechGlide) {
          const gm: any = (this.player as any).getTechGlide();
          const ratio2 = gm.max > 0 ? gm.value / gm.max : 0;
          const label2 = gm.active ? 'GLIDE ACTIVE' : (gm.ready ? 'GLIDE READY (Shift)' : `GLIDE ${Math.ceil((gm.max - gm.value)/1000)}s`);
          // Place directly above the tachyon bar with a violet tech theme
          this.drawThemedBar(ctx, classX, hpBarY - 26, maxW, 22, ratio2, '#a86bff', '#200a38', '#c59bff', label2);
        }
      } else if (id === 'heavy_gunner' && (this.player as any).getGunnerHeat) {
        const g: any = (this.player as any).getGunnerHeat();
        const ratio = g.max > 0 ? g.value / g.max : 0;
        const label = g.overheated ? 'OVERHEATED' : 'OVERHEAT (Spacebar)';
        // Orange heat theme
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#ff9300', '#3a1a00', '#ffb347', label);
      } else if (id === 'cyber_runner' && (this.player as any).getRunnerDash) {
        // Dash cooldown: show time until ready (fills up as it recharges)
        const d: any = (this.player as any).getRunnerDash();
        const ratio = d.max > 0 ? d.value / d.max : 0; // value counts up toward max
        const label = d.ready ? 'DASH READY (Shift)' : `DASH ${Math.ceil((d.max - d.value)/1000)}s`;
        // Cyan theme for Runner
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#26ffe9', '#07333a', '#00b3a3', label);
        // Second bar: Blade Cyclone cooldown/active state (Spacebar)
        if ((this.player as any).getBladeCyclone) {
          const bc: any = (this.player as any).getBladeCyclone();
          const ratio2 = bc.max > 0 ? bc.value / bc.max : 0;
          const label2 = bc.active ? 'CYCLONE ACTIVE' : (bc.ready ? 'CYCLONE READY (Spacebar)' : `CYCLONE ${Math.ceil((bc.max - bc.value)/1000)}s`);
          // Place directly above the dash bar with neon cyan theme
          this.drawThemedBar(ctx, classX, hpBarY - 26, maxW, 22, ratio2, '#26ffe9', '#07333a', '#00b3a3', label2);
        }
      } else if (id === 'data_sorcerer' && (this.player as any).getSorcererSigilMeter) {
        const m: any = (this.player as any).getSorcererSigilMeter();
        const ratio = m.max > 0 ? m.value / m.max : 0;
        const label = m.ready ? 'SIGIL READY (Spacebar)' : `SIGIL ${Math.ceil((m.max - m.value)/1000)}s`;
  // Golden theme for Sorcerer
  this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#ffd700', '#332600', '#ffe066', label);
      } else if (id === 'ghost_operative' && (this.player as any).getGhostSniperCharge) {
        const s: any = (this.player as any).getGhostSniperCharge();
        let ratio = 0;
        let label = 'GHOST SNIPER READY';
        if (s.state === 'charging') {
          ratio = s.max > 0 ? s.value / s.max : 0;
          label = `GHOST CHARGING ${Math.ceil((s.max - s.value)/1000)}s`;
        } else if (s.moving) {
          ratio = 0;
          label = 'HOLD STILL';
        }
        // Steel/ice theme for Ghost (cool cyan/ice)
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#c9ecff', '#13212b', '#e0f7ff', label);
  // Second bar: Phase Cloak cooldown/active state (15s CD, 5s duration)
        if ((this.player as any).getGhostCloakMeter) {
          const cm: any = (this.player as any).getGhostCloakMeter();
          const ratio2 = cm.max > 0 ? cm.value / cm.max : 0;
          const label2 = cm.active ? 'CLOAK ACTIVE' : (cm.ready ? 'CLOAK READY (Spacebar)' : `CLOAK ${Math.ceil((cm.max - cm.value)/1000)}s`);
          // Place directly above the sniper bar with same width
          this.drawThemedBar(ctx, classX, hpBarY - 26, maxW, 22, ratio2, '#8cf6ff', '#0e2a33', '#00d2ff', label2);
        }
      } else if (id === 'shadow_operative' && (this.player as any).getVoidSniperCharge) {
        const s: any = (this.player as any).getVoidSniperCharge();
        let ratio = 0;
        let label = 'VOID SNIPER READY';
        if (s.state === 'charging') {
          ratio = s.max > 0 ? s.value / s.max : 0;
          label = `VOID CHARGING ${Math.ceil((s.max - s.value)/1000)}s`;
        } else if (s.moving) {
          ratio = 0;
          label = 'HOLD STILL';
        }
        // Void theme for Shadow (deep purple with neon glow)
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#b266ff', '#220a33', '#d5a6ff', label);
        // Second bar: Umbral Surge cooldown/active state (20s CD, 5s duration)
        if ((this.player as any).getShadowSurgeMeter) {
          const um: any = (this.player as any).getShadowSurgeMeter();
          const ratio2 = um.max > 0 ? um.value / um.max : 0;
          const label2 = um.ready ? 'UMBRAL SURGE READY (Spacebar)' : (um.value > 0 && um.max === 5000 ? 'SURGE ACTIVE' : `SURGE ${Math.ceil((um.max - um.value)/1000)}s`);
          this.drawThemedBar(ctx, classX, hpBarY - 26, maxW, 22, ratio2, '#8c3cff', '#1a0830', '#bb88ff', label2);
        }
      } else if (id === 'neural_nomad' && (this.player as any).getOvermindMeter) {
        const m: any = (this.player as any).getOvermindMeter();
        const ratio = m.max > 0 ? m.value / m.max : 0;
        const label = m.active ? 'OVERMIND ACTIVE' : (m.ready ? 'OVERMIND READY (Spacebar)' : `OVERMIND ${Math.ceil((m.max - m.value)/1000)}s`);
        // Teal theme for Nomad
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#26ffe9', '#07333a', '#00b3a3', label);
      } else if (id === 'bio_engineer' && (this.player as any).getBioOutbreakMeter) {
        const m: any = (this.player as any).getBioOutbreakMeter();
        const ratio = m.max > 0 ? m.value / m.max : 0;
        const label = m.active ? 'OUTBREAK ACTIVE' : (m.ready ? 'OUTBREAK READY (Spacebar)' : `OUTBREAK ${Math.ceil((m.max - m.value)/1000)}s`);
        // Bio/acid green theme for Bio Engineer
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#73ff00', '#143300', '#adff2f', label);
        // Tiny biohazard icon hint to the left of the bar when active/ready
        try {
          const iconX = classX - 18;
          const iconY = hpBarY + 11;
          ctx.save();
          ctx.globalAlpha = m.active ? 0.95 : (m.ready ? 0.75 : 0.35);
          ctx.strokeStyle = m.active ? '#B6FF00' : '#73FF00';
          ctx.fillStyle = m.active ? 'rgba(182,255,0,0.18)' : 'rgba(115,255,0,0.10)';
          ctx.lineWidth = 2;
          // Simple trefoil-like symbol using three small arcs
          for (let i = 0; i < 3; i++) {
            const ang = i * (Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.arc(iconX + Math.cos(ang) * 6, iconY + Math.sin(ang) * 6, 5, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(iconX, iconY, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } catch { /* ignore */ }
      } else if (id === 'psionic_weaver' && (this.player as any).getWeaverLatticeMeter) {
        const m: any = (this.player as any).getWeaverLatticeMeter();
        const ratio = m.max > 0 ? m.value / m.max : 0;
        const label = m.active ? 'LATTICE ACTIVE' : (m.ready ? 'LATTICE READY (Spacebar)' : `LATTICE ${Math.ceil((m.max - m.value)/1000)}s`);
        // Magenta/violet theme for Weaver
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#ff4de3', '#2a0b28', '#ff94f0', label);
      } else if (id === 'rogue_hacker' && (this.player as any).getHackerHackMeter) {
        const m: any = (this.player as any).getHackerHackMeter();
        const ratio = m.max > 0 ? m.value / m.max : 0;
        const label = m.ready ? 'SYSTEM HACK READY (Spacebar)' : `SYSTEM HACK ${Math.ceil((m.max - m.value)/1000)}s`;
        // Orange/amber theme for Hacker
        this.drawThemedBar(ctx, classX, hpBarY, maxW, 22, ratio, '#ffa500', '#2a1400', '#ffd280', label);
      }
    } catch { /* ignore */ }

  // XP Bar
    const xpBarY = height - 34;
    const nextExp = this.player.getNextExp();
  this.drawThemedBar(ctx, 20, xpBarY, width - 40, 14, this.player.exp / nextExp, '#0099c8', '#022e33', COLOR_CYAN, `XP ${this.player.exp}/${nextExp}`);

  // Minimap (always on)
  const minimapPositionSize = minimapSize; // ensure consistent reference
  this.drawMinimap(ctx, this.player.x, this.player.y, enemies, worldW, worldH);

  // --- Tiny FPS readout centered in gap above minimap (no overlap) ---
  try {
    const fps = (window as any).__fpsSample | 0;
    const minimapX = width - minimapPositionSize - 20; // replicate minimap X
    const gapTopY = 12; // vertical center for the 20px gap (minimapY=20)
    ctx.save();
    ctx.font = 'bold 10px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8cf6ff';
    ctx.shadowColor = '#00ffff55';
    ctx.shadowBlur = 4;
    const label = fps + ' FPS';
    ctx.fillText(label, minimapX + minimapPositionSize / 2, gapTopY);
    ctx.restore();
  } catch { /* ignore */ }

  // Upgrade History Panel directly beneath minimap, same width & left edge
  const minimapPanelTop = 20; // must match drawMinimap
  const minimapX = width - minimapPositionSize - 20; // replicate internal minimap X calc
  const upgradesPanelX = minimapX;
  const upgradesPanelY = minimapPanelTop + minimapPositionSize + 20; // gap below minimap
  // Daytime indicator (tiny) directly below minimap top border, centered
  try {
    const env: any = (window as any).__environmentManager;
    if (env) {
      const dayLength = (env as any).dayLengthSec || 180;
      const dayT = (gameTime % dayLength) / dayLength; // 0..1
      const hours = Math.floor(dayT * 24);
      const minutesDay = Math.floor((dayT * 24 - hours) * 60);
      const label = `${hours.toString().padStart(2,'0')}:${minutesDay.toString().padStart(2,'0')}`;
      ctx.save();
      ctx.font = 'bold 11px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      const midX = minimapX + minimapPositionSize/2;
      // place slightly under minimap (above upgrades list) with subtle panel background
      const dy = minimapPanelTop + minimapPositionSize + 10; // 10px below bottom border
      ctx.fillStyle = 'rgba(6,14,18,0.55)';
      ctx.fillRect(midX-28, dy-12, 56, 16);
      ctx.strokeStyle = '#00b3a3';
      ctx.lineWidth = 1;
      ctx.strokeRect(midX-28+0.5, dy-12+0.5, 56-1, 16-1);
      this.drawGlowText(ctx, label, midX, dy, COLOR_TEXT, COLOR_CYAN, 6);
      ctx.restore();
    }
  } catch { /* ignore */ }
  this.drawUpgradeHistory(ctx, upgrades, upgradesPanelX, upgradesPanelY, minimapPositionSize);

    // Auto-aim toggle indicator (right-anchored, near class bars) — ensure visible during active gameplay for all operatives
    try {
      // Derive game state robustly (player.game may be undefined). Prefer global __game reference.
      const g: any = (window as any).__game;
      const st = (g && typeof g.getState === 'function') ? g.getState() : g?.state;
      if (st === 'GAME') {
        const mode: 'closest' | 'toughest' = ((window as any).__aimMode) || 'closest';
        // Place above class bars to the right
        const boxW = 120, boxH = 18;
        const x = width - boxW - 20;
        const y = hpBarY - 52; // above bars
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = COLOR_BG_PANEL;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.strokeStyle = COLOR_ACCENT_ALT; ctx.lineWidth = 1;
        ctx.strokeRect(x+0.5, y+0.5, boxW-1, boxH-1);
        ctx.font = '11px Orbitron, sans-serif';
        ctx.textAlign = 'center'; ctx.fillStyle = COLOR_TEXT;
        const label = mode === 'closest' ? 'Auto-aim: Closest' : 'Auto-aim: Toughest';
        this.drawGlowText(ctx, label, x + boxW/2, y + 13, COLOR_TEXT, COLOR_CYAN, 6);
        // Tiny tooltip below
        ctx.font = '9px Orbitron, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.fillText('Toggle (C)', x + boxW - 6, y + boxH + 10);
        ctx.restore();
      }
    } catch { /* ignore */ }

    ctx.restore();
  }

  private drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, progress: number, fg: string, bg: string) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, width * progress, height);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x, y, width, height);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, playerX: number, playerY: number, enemies: Enemy[], worldW: number, worldH: number): void {
  const minimapSize = 150;
  // Use logical (design) width/height instead of raw backing width so DPI scaling doesn't shift it off-screen.
  const dprMM = (window as any).devicePixelRatio || 1;
  const renderScaleMM = (window as any).__renderScale || 1;
  const backingToLogical = dprMM * renderScaleMM;
  const logicalW = ctx.canvas.width / backingToLogical;
  const logicalH = ctx.canvas.height / backingToLogical; // (not currently used but kept for consistency)
  const minimapX = logicalW - minimapSize - 20;
  const minimapY = 20;
    // View window radius around player (world units). Tighter for clarity than whole world.
    const viewHalf = 900; // shows 1800x1800 area; tweak for zoom feel
    const viewLeft = playerX - viewHalf;
    const viewTop = playerY - viewHalf;
    const viewSize = viewHalf * 2;
  const mapScale = minimapSize / viewSize; // uniform (square window)

    ctx.save();
    // Panel background
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#26ffe9';
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

    // Clip to minimap square so we can overshoot draws cleanly
    ctx.save();
    ctx.beginPath();
    ctx.rect(minimapX, minimapY, minimapSize, minimapSize);
    ctx.clip();

    // Draw structural rooms & corridors within window
    try {
      const rm = (window as any).__roomManager;
      if (rm) {
        const rooms = rm.getRooms?.() || [];
        ctx.lineWidth = 1;
        for (let i=0;i<rooms.length;i++) {
          const r = rooms[i];
          // Cull outside view window (with small pad to keep edges visible when entering)
          if (r.x + r.w < viewLeft - 40 || r.x > viewLeft + viewSize + 40 || r.y + r.h < viewTop - 40 || r.y > viewTop + viewSize + 40) continue;
          const sx = minimapX + (r.x - viewLeft) * mapScale;
          const sy = minimapY + (r.y - viewTop) * mapScale;
          const sw = r.w * mapScale;
          const sh = r.h * mapScale;
          ctx.fillStyle = r.visited ? 'rgba(38,255,233,0.18)' : 'rgba(0,140,200,0.10)';
          ctx.strokeStyle = r.biomeTag === 'neon' ? '#26ffe9' : '#008bff';
          ctx.fillRect(sx, sy, sw, sh);
          ctx.strokeRect(sx+0.5, sy+0.5, sw-1, sh-1);
        }
        const corrs = rm.getCorridors?.() || [];
        ctx.fillStyle = 'rgba(0,220,190,0.18)';
        for (let i=0;i<corrs.length;i++) {
          const c = corrs[i];
          if (c.x + c.w < viewLeft - 40 || c.x > viewLeft + viewSize + 40 || c.y + c.h < viewTop - 40 || c.y > viewTop + viewSize + 40) continue;
          ctx.fillRect(minimapX + (c.x - viewLeft) * mapScale, minimapY + (c.y - viewTop) * mapScale, c.w * mapScale, c.h * mapScale);
        }
      }
    } catch { /* ignore */ }

    // Player at center
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(minimapX + minimapSize/2, minimapY + minimapSize/2, 3.2, 0, Math.PI*2);
    ctx.fill();

    // Enemies (relative positions); fade those near edge — draw first so XP orbs appear above
    const enemyBaseAlpha = 0.95;
    for (let i=0;i<enemies.length;i++) {
      const e = enemies[i];
      if (!e.active) continue;
      const dx = e.x - viewLeft;
      const dy = e.y - viewTop;
      if (dx < 0 || dx > viewSize || dy < 0 || dy > viewSize) continue; // outside window
      // Edge fade: distance to center normalized
      const cx = dx - viewHalf;
      const cy = dy - viewHalf;
      const distNorm = Math.min(1, Math.sqrt(cx*cx + cy*cy) / viewHalf);
      const alpha = enemyBaseAlpha * (1 - distNorm*0.55);
      ctx.fillStyle = `rgba(255,60,60,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(minimapX + dx * mapScale, minimapY + dy * mapScale, 1.7, 0, Math.PI*2);
      ctx.fill();
    }

  // XP Orbs (yellow) above enemy dots with last-10s flicker/pulse
    try {
      const em: any = (window as any).__gameInstance?.getEnemyManager?.();
      const gems = em?.getGems ? em.getGems() : [];
      if (gems && gems.length) {
        const now = performance.now();
        for (let i = 0; i < gems.length; i++) {
          const g = gems[i];
          if (!g.active) continue;
          const dx = g.x - viewLeft;
          const dy = g.y - viewTop;
          if (dx < 0 || dx > viewSize || dy < 0 || dy > viewSize) continue;
          let r = 2.1; // baseline size on minimap
          let a = 0.95;
          const lifeAbs = (g as any).lifeMs as number | undefined;
          if (typeof lifeAbs === 'number') {
            const rem = lifeAbs - now;
            if (rem <= 10000) {
              const prog = Math.max(0, 1 - (rem / 10000));
              // Slight pulse and flicker
              r *= 1 + 0.25 * prog;
              a = ((Math.floor(now / 120) & 1) === 0) ? 1 : 0.5;
            }
          }
          // Draw as filled yellow dot with subtle glow
          const sx = minimapX + dx * mapScale;
          const sy = minimapY + dy * mapScale;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = '#FFD700';
          ctx.shadowColor = '#FFD700';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI*2);
          ctx.fill();
          ctx.restore();
        }
      }
    } catch { /* ignore */ }

    // Special item markers (Heal/Magnet/Nuke) and Treasures
    try {
      const em: any = (window as any).__gameInstance?.getEnemyManager?.();
      const items = em?.getSpecialItems ? em.getSpecialItems() : [];
      const treasures = em?.getTreasures ? em.getTreasures() : [];
      // Draw items with TTL-based flicker/pulse (last 10s)
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; if (!it?.active) continue;
        const dx = it.x - viewLeft; const dy = it.y - viewTop;
        if (dx < 0 || dx > viewSize || dy < 0 || dy > viewSize) continue;
        const sx = minimapX + dx * mapScale; const sy = minimapY + dy * mapScale;
        let r = 3; // base size
        let a = 0.95;
        // TTL flicker similar to XP gems
        try {
          const now = performance.now();
          const ttl = (it as any).ttlMs as number | undefined;
          if (typeof ttl === 'number') {
            const rem = ttl - now;
            if (rem <= 10000) {
              const prog = Math.max(0, 1 - (rem / 10000));
              r *= 1 + 0.3 * prog;
              a = ((Math.floor(now / 120) & 1) === 0) ? 1 : 0.55;
            }
          }
        } catch { /* ignore */ }
        // Color per type
        let col = '#66F9FF';
        if (it.type === 'HEAL') col = '#FF3344';
        else if (it.type === 'MAGNET') col = '#66F9FF';
        else if (it.type === 'NUKE') col = '#FFFFFF';
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
      // Draw treasures as cyan diamonds
      for (let i = 0; i < treasures.length; i++) {
        const t = treasures[i]; if (!t?.active) continue;
        const dx = t.x - viewLeft; const dy = t.y - viewTop;
        if (dx < 0 || dx > viewSize || dy < 0 || dy > viewSize) continue;
        const sx = minimapX + dx * mapScale; const sy = minimapY + dy * mapScale;
        const s = 3.5; // half size of diamond
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#66CCFF';
        ctx.shadowColor = '#66CCFF'; ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(sx, sy - s);
        ctx.lineTo(sx + s, sy);
        ctx.lineTo(sx, sy + s);
        ctx.lineTo(sx - s, sy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    } catch { /* ignore */ }

    ctx.restore(); // clip
    ctx.restore();
  }

  private drawUpgradeHistory(ctx: CanvasRenderingContext2D, upgrades: string[], panelX: number, panelY: number, panelWidth: number = 150): void {
    ctx.save();
    ctx.font = '12px Orbitron, sans-serif';
    ctx.textAlign = 'left';
      // Build condensed map of highest levels for weapons & passives
      const weaponLevels: Record<string, number> = {};
      const passiveLevels: Record<string, number> = {};
      for (const raw of upgrades) {
        if (raw.startsWith('Weapon Upgrade:')) {
          const m = raw.match(/Weapon Upgrade:\s+(.+) Lv\.(\d+)/);
          if (m) {
            const name = m[1].trim();
            const lvl = parseInt(m[2], 10);
            if (!weaponLevels[name] || weaponLevels[name] < lvl) weaponLevels[name] = lvl;
          }
        } else if (raw.startsWith('Weapon Evolution:')) {
          // treat evolution as new weapon at level 1 if needed
          const m = raw.match(/Weapon Evolution:\s+.+ -> (.+)/);
          if (m) weaponLevels[m[1].trim()] = weaponLevels[m[1].trim()] || 1;
        } else if (raw.startsWith('Passive Unlock:')) {
          const m = raw.match(/Passive Unlock:\s+(.+) Lv\.(\d+)/);
          if (m) {
            const name = m[1].trim();
            const lvl = parseInt(m[2], 10);
            if (!passiveLevels[name] || passiveLevels[name] < lvl) passiveLevels[name] = lvl;
          }
        } else if (raw.startsWith('Passive Upgrade:')) {
          const m = raw.match(/Passive Upgrade:\s+(.+) Lv\.(\d+)/);
          if (m) {
            const name = m[1].trim();
            const lvl = parseInt(m[2], 10);
            if (!passiveLevels[name] || passiveLevels[name] < lvl) passiveLevels[name] = lvl;
          }
        }
      }
      // Compose display lines
    let displayUpgrades: string[] = [];
      for (const [name, lvl] of Object.entries(weaponLevels)) {
        displayUpgrades.push(`Wep: ${name} Lv.${lvl}`);
      }
      for (const [name, lvl] of Object.entries(passiveLevels)) {
        displayUpgrades.push(`Pas: ${name} Lv.${lvl}`);
      }
      // Sort for stable ordering (weapons first) then alphabetically
      displayUpgrades.sort((a,b)=>{
        const aw = a.startsWith('Wep:') ? 0 : 1;
        const bw = b.startsWith('Wep:') ? 0 : 1;
        if (aw !== bw) return aw - bw;
        return a.localeCompare(b);
      });
    // Simple truncate to avoid overflow horizontally
    // Dynamically size font so longest line fits panel width (minus padding)
    // Preserve full weapon/passive names (avoid horizontal truncation when possible)
    const horizontalPadding = 24; // left + right combined inside panel
    const availableLineWidth = panelWidth - horizontalPadding;
    let contentFontSize = 12;
    const minFontSize = 8;
    const measureFits = (size: number) => {
      ctx.font = `${size}px Orbitron, sans-serif`;
      for (let i = 0; i < displayUpgrades.length; i++) {
        if (ctx.measureText(displayUpgrades[i]).width > availableLineWidth) return false;
      }
      return true;
    };
    // Decrease font size until all lines fit or reach min
    while (contentFontSize > minFontSize && !measureFits(contentFontSize)) {
      contentFontSize -= 1;
    }
    // If still overflowing at min size, fall back to truncation with ellipsis
    if (!measureFits(contentFontSize)) {
      ctx.font = `${contentFontSize}px Orbitron, sans-serif`;
      displayUpgrades = displayUpgrades.map(line => {
        let truncated = line;
        while (truncated.length > 2 && ctx.measureText(truncated + '…').width > availableLineWidth) {
          truncated = truncated.slice(0, -1);
        }
        return truncated === line ? line : truncated + '…';
      });
    }
    const lineHeight = 16;
    const headerSpace = 50;
    const desiredHeight = headerSpace + displayUpgrades.length * lineHeight + 12;
    const maxHeight = 340;
    const panelHeight = Math.min(maxHeight, desiredHeight);
    const maxVisibleLines = Math.floor((panelHeight - headerSpace - 12) / lineHeight);
    if (displayUpgrades.length > maxVisibleLines) {
      // Keep most recent (end of array) lines, add ellipsis marker at top
      displayUpgrades = ['…'] .concat(displayUpgrades.slice(displayUpgrades.length - maxVisibleLines));
    }
    ctx.restore();
  const accentPrimary = '#26ffe9';
  const accentSecondary = '#00b3a3';
  const panelBase = 'rgba(6,14,18,0.55)';
  this.drawPanel(ctx, panelX, panelY, panelWidth, panelHeight, () => {
      ctx.save();
      // Title bar background inside panel
      const titleBarH = 34;
      const gradTitle = ctx.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY);
  gradTitle.addColorStop(0, 'rgba(0,179,163,0.25)');
  gradTitle.addColorStop(1, 'rgba(38,255,233,0.18)');
      ctx.fillStyle = gradTitle;
      ctx.fillRect(panelX + 1, panelY + 1, panelWidth - 2, titleBarH);
      // Divider line
  ctx.strokeStyle = '#26ffe955';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panelX + 4, panelY + titleBarH + 0.5);
      ctx.lineTo(panelX + panelWidth - 4, panelY + titleBarH + 0.5);
      ctx.stroke();
      // Header text (reduced glow to avoid bleeding outside)
  ctx.font = 'bold 20px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  this.drawGlowText(ctx, 'UPGRADES', panelX + panelWidth / 2, panelY + 24, '#e3fefb', accentSecondary, 4);
  ctx.textAlign = 'left';
      // Content list
  ctx.font = `${contentFontSize}px Orbitron, sans-serif`;
      ctx.textAlign = 'left';
      let y = panelY + titleBarH + 18;
      for (let i = 0; i < displayUpgrades.length; i++) {
        ctx.fillStyle = 'rgba(180,220,255,0.85)';
        ctx.fillText(displayUpgrades[i], panelX + 12, y);
        y += lineHeight;
      }
      ctx.restore();
    });
  }

  // --- Helper: Neon panel wrapper ---
  private drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, body: () => void) {
    ctx.save();
    // Outer glow
  ctx.shadowColor = 'rgba(38,255,233,0.35)';
    ctx.shadowBlur = 18;
  ctx.fillStyle = 'rgba(6,14,18,0.55)';
    ctx.fillRect(x, y, w, h);
    // Inner gradient overlay
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, 'rgba(0,179,163,0.10)');
  grad.addColorStop(0.55, 'rgba(38,255,233,0.05)');
  grad.addColorStop(1, 'rgba(0,179,163,0.08)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    // Border
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(38,255,233,0.72)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // Corner accents
  ctx.strokeStyle = '#00b3a3cc';
    const c = 18;
    ctx.beginPath();
    ctx.moveTo(x, y + c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + c);
    ctx.moveTo(x, y + h - c);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + c, y + h);
    ctx.moveTo(x + w - c, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - c);
    ctx.stroke();
    ctx.restore();
    // Body
    body();
  }

  // --- Helper: Themed neon panel wrapper (accent by class color) ---
  private drawPanelThemed(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accentHex: string, body: () => void) {
    // Convert accent to rgba variants
    const rgb = this.hexToRgb(accentHex) || { r: 38, g: 255, b: 233 };
    const glow = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
    const border = `rgba(${rgb.r},${rgb.g},${rgb.b},0.78)`;
    const corner = `rgba(${rgb.r},${rgb.g},${rgb.b},0.80)`;
    const gradA = `rgba(${rgb.r},${rgb.g},${rgb.b},0.10)`;
    const gradB = `rgba(${rgb.r},${rgb.g},${rgb.b},0.06)`;
    const gradC = `rgba(${rgb.r},${rgb.g},${rgb.b},0.09)`;
    ctx.save();
    // Outer glow
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(6,14,18,0.55)';
    ctx.fillRect(x, y, w, h);
    // Inner gradient overlay tinted by accent
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, gradA);
    grad.addColorStop(0.55, gradB);
    grad.addColorStop(1, gradC);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    // Border
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = border;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // Corner accents
    ctx.strokeStyle = corner;
    const c = 18;
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
    ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
    ctx.stroke();
    ctx.restore();
    // Body
    body();
  }

  // --- Helper: Glow text ---
  private drawGlowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, glow: string, glowSize: number) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = glowSize;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // --- Helper: Themed bar with label ---
  private drawThemedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, progress: number, fg: string, bg: string, accent: string, label: string) {
    progress = Math.max(0, Math.min(1, progress));
    ctx.save();
    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    // Foreground gradient
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, fg);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w * progress, h);
    // Border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // Label (centered vertically for readability)
  ctx.font = '12px Orbitron, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Add subtle dark backing for contrast
  const textY = y + h / 2;
  const padX = 6;
  const padY = 4;
  const metrics = ctx.measureText(label);
  const textW = metrics.width + padX * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 4 - 2, textY - (metrics.actualBoundingBoxAscent / 2) - padY, textW, (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + padY * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.fillText(label, x + 4 + padX, textY + 1);
    ctx.restore();
  }

  private computeCritChance(): number {
    // Base chance from attributes
    const agility = this.player.agility || 0;
    const luck = this.player.luck || 0;
    let basePct = Math.min(60, (agility * 0.8 + luck * 1.2) * 0.5); // percent (0..60)
    const bonus = (this.player as any).critBonus;
    if (typeof bonus === 'number') {
      basePct += bonus * 100; // convert 0..0.5 to 0..50%
    }
    return Math.min(100, basePct);
  }

  private computePowerScore(): number {
    return Math.round(
      (this.player.bulletDamage || 0) * 1.8 +
      (this.player.strength || 0) * 1.2 +
      (this.player.intelligence || 0) * 1.4 +
      (this.player.agility || 0) * 1.1 +
      (this.player.luck || 0) * 0.9 +
      (this.player.defense || 0) * 0.8 +
      (this.player.speed || 0) * 3
    );
  }

  // --- Helper: Fit text to a max width by reducing font size and adding ellipsis if needed ---
  private fitTextToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxFontPx: number, minFontPx: number): { text: string; fontSize: number } {
    let size = Math.max(minFontPx, Math.min(maxFontPx, Math.floor(maxFontPx)));
    // Try shrinking font until it fits or reach min size
    for (; size >= minFontPx; size--) {
      ctx.font = `bold ${size}px Orbitron, sans-serif`;
      const w = ctx.measureText(text).width;
      if (w <= maxWidth) return { text, fontSize: size };
    }
    // At min size and still too long: truncate with ellipsis
    ctx.font = `bold ${minFontPx}px Orbitron, sans-serif`;
    const ell = '…';
    let fitted = '';
    for (let i = 0; i < text.length; i++) {
      const candidate = text.slice(0, i + 1) + ell;
      if (ctx.measureText(candidate).width > maxWidth) {
        break;
      }
      fitted = candidate;
    }
    if (!fitted) {
      // Fallback: just show ellipsis
      fitted = ell;
    }
    return { text: fitted, fontSize: minFontPx };
  }

  // --- Helper: Build simplified, class-relevant stat lines (now with extended stats) ---
  private getSimpleClassStats(): [string, string][] {
    const id = (this.player as any)?.characterData?.id as string | undefined;
    const crit = Math.round(this.computeCritChance());
    const dmg = Math.round(this.player.bulletDamage || 0);
    const spd = (this.player.speed || 0).toFixed(2);
    const dps = Math.max(0, Math.round(this.currentDPS || 0)).toString();
    const hp = `${Math.floor(this.player.hp)}/${Math.floor(this.player.maxHp)}`;
    const atk = (this.player.attackSpeed || 1).toFixed(2);
    const intel = this.player.intelligence ?? 0;
    const agi = this.player.agility ?? 0;
    const def = this.player.defense ?? 0;
    const luck = this.player.luck ?? 0;
    const regen = `${(this.player.regen || 0).toFixed(1)}/s`;
    const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
    const areaPct = `${Math.round((areaMul || 1) * 100)}%`;
    const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const fireRateSource = (this.player as any)?.getFireRateModifier?.() ?? (this.player as any)?.fireRateModifier ?? 1;
    const atkSpdMul = (this.player.attackSpeed || 1);
    const fireRateMul = Math.max(0.1, atkSpdMul * (fireRateSource || 1));

    // Core weapon details (class default) to show projectiles and cooldown
    let coreProj = '-';
    let coreCdLabel = '-';
    try {
      const coreType = (this.player as any)?.characterData?.defaultWeapon;
      const spec: any = WEAPON_SPECS?.[coreType as keyof typeof WEAPON_SPECS];
      if (spec) {
        const lvl = (this.player as any)?.activeWeapons?.get?.(coreType) || 1;
        let scaled: any = undefined;
        if (typeof spec.getLevelStats === 'function') {
          try { scaled = spec.getLevelStats(lvl); } catch {}
        }
        const salvo = (scaled && typeof scaled.salvo === 'number') ? scaled.salvo : (typeof spec.salvo === 'number' ? spec.salvo : undefined);
        if (typeof salvo === 'number') coreProj = String(salvo);
        // Prefer ms if available
        const cdMs = (scaled && typeof scaled.cooldownMs === 'number') ? scaled.cooldownMs
                    : (typeof spec.cooldownMs === 'number' ? spec.cooldownMs : undefined);
        const cd = (scaled && typeof scaled.cooldown === 'number') ? scaled.cooldown
                   : (typeof spec.cooldown === 'number' ? spec.cooldown : undefined);
        let seconds: number | undefined = undefined;
        if (typeof cdMs === 'number') seconds = cdMs / 1000;
        else if (typeof cd === 'number' && cd > 0) seconds = cd / 60; // frames -> seconds (assuming 60fps)
        if (typeof seconds === 'number') coreCdLabel = `${seconds.toFixed(2)}s`;
      }
    } catch {}

    // Defaults for all classes
    // Base 5 stats
    let stats: [string, string][] = [
      ['HP', hp],
      ['Damage', `${dmg}`],
      ['Speed', spd],
      ['Crit %', `${crit}`],
      ['DPS', dps],
    ];

    // Extended 5 stats (universal across classes)
    const extended: [string, string][] = [
      ['Projectiles', coreProj],
      ['Atk Spd', `x${Number(atk).toFixed(2)}`],
      ['Dmg Mult', `x${(dmgMul || 1).toFixed(2)}`],
      ['Area', areaPct],
      ['CD', coreCdLabel],
    ];

    switch (id) {
      case 'heavy_gunner':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Atk Spd', atk], ['Defense', `${def}`], ['DPS', dps] ];
        break;
      case 'cyber_runner':
        stats = [ ['HP', hp], ['Speed', spd], ['Agility', `${agi}`], ['Crit %', `${crit}`], ['DPS', dps] ];
        break;
      case 'bio_engineer':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Intel', `${intel}`], ['Regen', regen], ['DPS', dps] ];
        break;
      case 'data_sorcerer':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Intel', `${intel}`], ['Area', areaPct], ['DPS', dps] ];
        break;
      case 'ghost_operative':
      case 'shadow_operative':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Crit %', `${crit}`], ['Agility', `${agi}`], ['DPS', dps] ];
        break;
      case 'neural_nomad':
      case 'psionic_weaver':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Intel', `${intel}`], ['Area', areaPct], ['DPS', dps] ];
        break;
      case 'rogue_hacker':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Intel', `${intel}`], ['Luck', `${luck}`], ['DPS', dps] ];
        break;
      case 'titan_mech':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Defense', `${def}`], ['Speed', spd], ['DPS', dps] ];
        break;
      case 'tech_warrior':
        stats = [ ['HP', hp], ['Damage', `${dmg}`], ['Atk Spd', atk], ['Defense', `${def}`], ['DPS', dps] ];
        break;
      default:
    // keep defaults
    break;
    }
  // Always append extended stats
  return stats.concat(extended);
  }

  // --- Helper: Hex to RGB ---
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  public drawAliveEnemiesCount(ctx: CanvasRenderingContext2D, count: number): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    const x = Math.max(10, ctx.canvas.width - 140);
    const y = 20;
    ctx.fillText(`Enemies: ${count}`, x, y);
    ctx.restore();
  }
}
