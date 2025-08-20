import { Player } from '../game/Player';
import { AssetLoader } from '../game/AssetLoader';
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
  // We'll draw FPS later once minimap position vars are defined so it sits in the gap above minimap.

  // --- LEFT PANEL (Stats + Level) ---
  const panelX = 14;
  const panelY = 14;
  // Match minimap width for consistent layout (minimap = 150)
  const minimapSize = 150;
  const panelW = minimapSize;
  // Dynamic panel height: base + per-stat lines (15 stats currently)
  const statCount = 15;
  const panelH = 70 + statCount * 20 + 16;
  this.drawPanel(ctx, panelX, panelY, panelW, panelH, () => {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = FONT_SECTION;
  this.drawGlowText(ctx, `LEVEL ${this.player.level}`, panelX + 12, panelY + 32, COLOR_TEXT, COLOR_ACCENT_ALT, 8);

      // Derive extended stats
      const critChance = this.computeCritChance();
      const survivability = Math.round(this.player.maxHp * (1 + (this.player.defense || 0) / 50));
      const powerScore = this.computePowerScore();

      const stats: [string, string][] = [
        ['HP', `${this.player.hp} / ${this.player.maxHp}`],
        ['Speed', `${this.player.speed.toFixed(2)}`],
        ['Damage', `${this.player.bulletDamage ?? 0}`],
        ['Strength', `${this.player.strength ?? 0}`],
        ['Defense', `${this.player.defense ?? 0}`],
        ['Atk Spd', `${(this.player.attackSpeed ?? 1).toFixed(2)}`],
        ['Magnet', `${this.player.magnetRadius ?? 0}`],
        ['Regen', `${(this.player.regen || 0).toFixed(1)}/s`],
        ['Luck', `${this.player.luck ?? 0}`],
        ['Intel', `${this.player.intelligence ?? 0}`],
        ['Agility', `${this.player.agility ?? 0}`],
        ['Crit %', `${critChance.toFixed(0)}`],
        ['Survive', `${survivability}`],
        ['Power', `${powerScore}`],
        ['DPS', `${this.currentDPS.toFixed(2)}`]
      ];
      ctx.font = FONT_STAT;
      ctx.fillStyle = COLOR_TEXT;
      let y = panelY + 60;
      // Dynamic right-aligned values for narrow panel
      for (let i = 0; i < stats.length; i++) {
        const [label, value] = stats[i];
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(label + ':', panelX + 10, y);
        ctx.fillStyle = COLOR_CYAN;
        ctx.textAlign = 'right';
        ctx.fillText(value, panelX + panelW - 10, y);
        y += 20;
      }
      ctx.restore();
    });

    // HP Bar
    const hpBarY = height - 64;
    const hpBarWidth = Math.min(480, width - 320);
  this.drawThemedBar(ctx, 20, hpBarY, hpBarWidth, 22, this.player.hp / this.player.maxHp, '#fe2740', '#4a0910', COLOR_ACCENT_ALT, `HP ${this.player.hp}/${this.player.maxHp}`);

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
  this.drawUpgradeHistory(ctx, upgrades, upgradesPanelX, upgradesPanelY, minimapPositionSize);

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
    const minimapX = ctx.canvas.width - minimapSize - 20;
    const minimapY = 20;
    // View window radius around player (world units). Tighter for clarity than whole world.
    const viewHalf = 900; // shows 1800x1800 area; tweak for zoom feel
    const viewLeft = playerX - viewHalf;
    const viewTop = playerY - viewHalf;
    const viewSize = viewHalf * 2;
    const scale = minimapSize / viewSize; // uniform (square window)

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
          const sx = minimapX + (r.x - viewLeft) * scale;
          const sy = minimapY + (r.y - viewTop) * scale;
          const sw = r.w * scale;
          const sh = r.h * scale;
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
          ctx.fillRect(minimapX + (c.x - viewLeft) * scale, minimapY + (c.y - viewTop) * scale, c.w * scale, c.h * scale);
        }
      }
    } catch { /* ignore */ }

    // Player at center
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(minimapX + minimapSize/2, minimapY + minimapSize/2, 3.2, 0, Math.PI*2);
    ctx.fill();

    // Enemies (relative positions); fade those near edge
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
      ctx.arc(minimapX + dx * scale, minimapY + dy * scale, 1.7, 0, Math.PI*2);
      ctx.fill();
    }

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
    // Mirror formula used in character data derivation
    const agility = this.player.agility || 0;
    const luck = this.player.luck || 0;
    return Math.min(60, (agility * 0.8 + luck * 1.2) * 0.5);
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
