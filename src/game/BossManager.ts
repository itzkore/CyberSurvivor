import { Player } from './Player';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { BOSS_SPAWN_INTERVAL_SEC } from './Balance';

export type Boss = { x: number; y: number; hp: number; maxHp: number; radius: number; active: boolean; telegraph: number; state: 'TELEGRAPH' | 'ACTIVE' | 'DEAD'; attackTimer: number; _damageFlash?: number; specialCharge?: number; specialReady?: boolean; lastContactHitTime?: number } | null;

export class BossManager {
  private player: Player;
  private boss: Boss = null;
  private spawnTimer: number = 0; // Use gameTime directly
  private particleManager: ParticleManager | null = null;
  private assetLoader: AssetLoader | null = null;
  private bossImage: HTMLImageElement | null = null;
  private difficulty: number = 1;
  private lastBossSpawnTime: number = 0; // Track last spawn time
  private bossSpawnCount: number = 0; // Infinite scaling counter
  // Visual walk-cycle for boss: 1s flip interval
  private bossWalkFlip: boolean = false;
  private bossWalkFlipTimerMs: number = 0;
  private readonly bossWalkIntervalMs: number = 1000;
  // Spells state
  private spellCooldownMs: number = 5000;
  private nextSpellAtMs: number = 0;
  private spellState: 'IDLE' | 'NOVA_CHARGE' | 'NOVA_RELEASE' | 'LINEUP' | 'DASH' = 'IDLE';
  private spellTimerMs: number = 0;
  private novaRadius: number = 0;
  private novaMaxRadius: number = 320; // slightly reduced for fairness
  private novaHitApplied: boolean = false;
  private dashDirX: number = 0;
  private dashDirY: number = 0;
  private dashSpeedPxPerMs: number = 0.75; // slower dash to improve dodgeability
  private dashDurationMs: number = 420; // shorter window of danger
  private dashElapsedMs: number = 0;
  // Dash fairness controls
  private dashDidHitOnce: boolean = false; // limit dash contact to a single hit
  private postDashRecoverUntilMs: number = 0; // brief recovery where boss can't body-check

  constructor(player: Player, particleManager?: ParticleManager, difficulty = 1, assetLoader?: AssetLoader) {
    this.player = player;
    this.particleManager = particleManager || null;
    this.difficulty = difficulty;
    this.lastBossSpawnTime = 0; // Initialize to 0
    this.assetLoader = assetLoader || null;
    this.loadBossImage();
  // Expose globally for systems that need boss reference
  try { (window as any).__bossManager = this; } catch {}
  }

  private loadBossImage() {
    const path = (location.protocol === 'file:' ? './assets/boss/boss_phase1.png' : '/assets/boss/boss_phase1.png');
    const img = new Image();
    img.onload = () => { this.bossImage = img; };
    img.onerror = () => { /* fallback: circle */ };
    img.src = path;
  }

  public update(deltaTime: number, gameTime: number) { // Added gameTime parameter
    if (!this.boss) {
      // Spawn boss on paced interval (default 180s) to stretch run length
      if (gameTime - this.lastBossSpawnTime >= BOSS_SPAWN_INTERVAL_SEC) {
        this.spawnBoss();
        this.lastBossSpawnTime = gameTime;
      }
    } else if (this.boss.state === 'TELEGRAPH') {
      this.boss.telegraph--;
      // Throttle telegraph particles to every 3rd frame to reduce GPU pressure
      if (this.particleManager && this.boss.telegraph % 3 === 0) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f55');
      if (this.boss.telegraph <= 0) {
        this.boss.state = 'ACTIVE';
  const haste = Math.min(12, (this.bossSpawnCount - 1) * 2);
  this.boss.attackTimer = 60 - haste;
      }
    } else if (this.boss && this.boss.state === 'ACTIVE') {
      const dx = this.player.x - this.boss.x;
      const dy = this.player.y - this.boss.y;
      const dist = Math.hypot(dx, dy);
      const isSpellActive = this.spellState !== 'IDLE';
      // Special attack logic
      if (this.boss.specialCharge == null) this.boss.specialCharge = 0;
      if (this.boss.specialReady == null) this.boss.specialReady = false;
      if (!this.boss.specialReady) {
        // Move slower
        if (!isSpellActive && dist > 0) {
          const stepX = (dx / dist) * 0.7;
          const stepY = (dy / dist) * 0.7;
          this.boss.x += stepX;
          this.boss.y += stepY;
          // Track last non-zero horizontal direction for facing
          const bAny: any = this.boss as any;
          if (Math.abs(stepX) > 0.0001) bAny._facingX = stepX < 0 ? -1 : 1;
          // Walk-cycle flip at fixed interval while moving
          const mvMag = Math.hypot(stepX, stepY);
          if (mvMag > 0.01) {
            this.bossWalkFlipTimerMs += deltaTime;
            while (this.bossWalkFlipTimerMs >= this.bossWalkIntervalMs) {
              this.bossWalkFlip = !this.bossWalkFlip;
              this.bossWalkFlipTimerMs -= this.bossWalkIntervalMs;
            }
          }
        }
        this.boss.specialCharge++;
        if (this.boss.specialCharge > 360) { // Charge for 6 seconds
          this.boss.specialReady = true;
          this.boss.specialCharge = 0;
        }
      } else {
        // Telegraph special attack: stop and charge for 3 seconds
        this.boss.specialCharge++;
        if (this.boss.specialCharge < 180) {
          // Show telegraph effect (spawn particles less frequently)
          if (this.particleManager && this.boss.specialCharge % 5 === 0) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#FF00FF'); // Spawn fewer particles every 5 frames
        } else {
          // Unleash special attack (e.g., massive area damage)
          if (dist < this.boss.radius + 120) {
            const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
            this.player.hp -= Math.round(80 * specialScale); // Scaled special damage
            if (this.particleManager) this.particleManager.spawn(this.player.x, this.player.y, 2, '#FF0000'); // Reduced particles
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 300, intensity: 10 } })); // Screen shake on special attack
          }
          this.boss.specialReady = false;
          this.boss.specialCharge = 0;
        }
      }
      // Clamp boss to walkable after movement
      const rm = (window as any).__roomManager;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const c = rm.clampToWalkable(this.boss.x, this.boss.y, this.boss.radius || 80);
        this.boss.x = c.x; this.boss.y = c.y;
      }
      this.boss.attackTimer--;
      if (this.boss.attackTimer <= 0) {
        this.launchAttackWave();
  const spawnHaste = Math.min(15, (this.bossSpawnCount - 1) * 1.5);
  this.boss.attackTimer = Math.max(30, 60 - (this.difficulty - 1) * 10 - spawnHaste);
      }
      // Decide and advance spells when not in boss special telegraph
      if (!this.boss.specialReady) {
        if (performance.now() >= this.nextSpellAtMs && this.spellState === 'IDLE') {
          const pick = (this.bossSpawnCount + Math.floor(performance.now() / 10000)) % 2;
          if (pick === 0) {
            this.startShockNova();
          } else {
            this.startLineDash(dx, dy, dist);
          }
        }
        if (this.spellState !== 'IDLE') this.updateSpells(deltaTime);
      }
        // Player-boss collision with 1s cooldown contact damage (30 fixed damage to player)
      if (dist < this.player.radius + this.boss.radius) {
        const now = performance.now();
        // During post-dash recovery, suppress general contact damage
        if (now < this.postDashRecoverUntilMs) {
          // still apply tiny positional separation to avoid sticking
          if (dist > 0) {
            const nx = dx / dist; const ny = dy / dist;
            this.player.x -= nx * 6; this.player.y -= ny * 6;
            this.boss.x += nx * 4; this.boss.y += ny * 4;
          }
        } else {
        if (!this.boss.lastContactHitTime || now - this.boss.lastContactHitTime >= 1000) {
          this.boss.lastContactHitTime = now;
          this.player.hp -= 30; // fixed contact damage
          this.player.hp -= Math.round(30 * (1 + 0.18 * (this.bossSpawnCount - 1))) - 30; // apply additional scaled damage over base
          this.boss._damageFlash = 12; // flash when successful hit
          // Knockback only when damage actually applied
          if (dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const playerKb = 64; // stronger push to emphasize hit
            const bossKb = 24;
            this.player.x -= nx * playerKb;
            this.player.y -= ny * playerKb;
            this.boss.x += nx * bossKb;
            this.boss.y += ny * bossKb;
          }
          if (this.particleManager) {
            this.particleManager.spawn(this.player.x, this.player.y, 2, '#f00');
          }
        }
        }
      }
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        this.boss._damageFlash--;
      }
      // Phase thresholds
      const hpPct = this.boss.hp / this.boss.maxHp;
      if (hpPct < 0.4 && (this.boss as any)._phase < 3) {
        (this.boss as any)._phase = 3;
        this.boss.attackTimer = 30; // faster
        if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#FF00FF');
      } else if (hpPct < 0.7 && (this.boss as any)._phase < 2) {
        (this.boss as any)._phase = 2;
        this.boss.attackTimer = 45;
        if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#C400FF');
      }
      if (this.boss.hp <= 0) {
        // Mark dead and dispatch rewards/FX
        this.boss.state = 'DEAD';
        this.spawnChest(this.boss.x, this.boss.y); // Spawn chest on boss defeat
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 500, intensity: 15 } })); // Stronger shake on boss defeat
        // Vacuum gems QoL
        window.dispatchEvent(new CustomEvent('bossGemVacuum'));
        // Notify game systems for reward handling (double upgrade)
        window.dispatchEvent(new CustomEvent('bossDefeated'));
        // Despawn immediately and start interval timer for next spawn
        this.boss = null;
        this.spellState = 'IDLE';
        this.spellTimerMs = 0;
        this.novaHitApplied = false;
        this.nextSpellAtMs = 0;
  // Do not reset lastBossSpawnTime here; keep interval anchored to original schedule
  // This ensures if a boss dies late (after the next interval), the next boss spawns immediately.
      }
    }
  }

  private spawnBoss() {
    // Spawn boss close to player
    const px = this.player.x;
    const py = this.player.y;
    const angle = Math.random() * Math.PI * 2;
  const dist = 300 + Math.random() * 160; // spawn slightly farther to reduce immediate crowding
    const bx = px + Math.cos(angle) * dist;
    const by = py + Math.sin(angle) * dist;
    // Oppenheimer-style cinematic entrance: screen shake, slow-motion, flash, sound event
    if (window && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('bossSpawn', { detail: { x: bx, y: by, cinematic: true } }));
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 200, intensity: 8 } })); // Initial shake on boss spawn
    }
  const bossHp = 1500; // Base boss HP (scaled per spawn)
    let spawnX = bx, spawnY = by;
    const rm = (window as any).__roomManager;
    if (rm && typeof rm.clampToWalkable === 'function') {
      const c = rm.clampToWalkable(bx, by, 80);
      spawnX = c.x; spawnY = c.y;
    }
  this.bossSpawnCount++;
  // Reset boss walk-cycle state on new spawn
  this.bossWalkFlip = false;
  this.bossWalkFlipTimerMs = 0;
    const n = this.bossSpawnCount;
    const hpScale = Math.pow(1 + 0.40 * (n - 1), 1.12);
    const scaledHp = Math.round(bossHp * hpScale);
    this.boss = {
      x: spawnX,
      y: spawnY,
      hp: scaledHp,
  maxHp: scaledHp, // Set maxHp for HP bar drawing
      radius: 80, // half previous size
      active: true,
      telegraph: 180,
      state: 'TELEGRAPH',
      attackTimer: 0,
      _damageFlash: 0
    };
  (this.boss as any)._phase = 1;
  // Prime spells after brief delay to let player orient
  this.nextSpellAtMs = performance.now() + 2500;
  this.spellState = 'IDLE';
  this.spellTimerMs = 0;
  this.novaHitApplied = false;
    // Immediately activate boss fight overlay
    if (window && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('bossFightStart', { detail: { boss: this.boss } }));
    }
  }

  private spawnChest(x: number, y: number): void {
    // Dispatch an event that EnemyManager (or a new ChestManager) can listen to
    window.dispatchEvent(new CustomEvent('spawnChest', { detail: { x, y } }));
  }

  private launchAttackWave() {
    if (!this.boss) return;
    // spawn telegraph pulses before actual projectiles
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f90'); // Reduced particles
    // Boss spawns minions every 3rd attack
    if (Math.random() < 0.33) {
      if (window && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('bossMinionSpawn', { detail: { x: this.boss.x, y: this.boss.y, count: 3 + this.difficulty } }));
      }
    }
    // create projectiles that will be handled by Game-level projectile system
    const event = new CustomEvent('bossAttack', { detail: { x: this.boss.x, y: this.boss.y, intensity: this.difficulty } });
    window.dispatchEvent(event);
    // Visual effect: flash
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#fff'); // Reduced particles
    // XP spray at 20% HP chunks
    if (this.boss && this.boss.state === 'ACTIVE') {
      const pct = this.boss.hp / this.boss.maxHp;
      const lastPct = (this.boss as any)._lastSprayPct ?? 1;
      if (pct < lastPct - 0.20) {
        (this.boss as any)._lastSprayPct = pct;
        window.dispatchEvent(new CustomEvent('bossXPSpray', { detail: { x: this.boss.x, y: this.boss.y } }));
      }
    }
  }
 
   public draw(ctx: CanvasRenderingContext2D) {
    if (!this.boss) return;
    if (this.boss.state === 'TELEGRAPH') {
      // Oppenheimer-style telegraph: slow-motion, intense glow, cinematic overlay
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.font = 'bold 64px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#FF00FF';
      ctx.shadowBlur = 32;
      ctx.fillText('BOSS APPROACHING', ctx.canvas.width/2, ctx.canvas.height/2 - 80);
      ctx.font = 'bold 32px Orbitron, Arial';
      ctx.fillStyle = '#FF00FF';
      ctx.fillText('Prepare for Impact', ctx.canvas.width/2, ctx.canvas.height/2 - 20);
      ctx.restore();
      // Massive glowing telegraph ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.8)';
      ctx.lineWidth = 24;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 64;
      ctx.beginPath();
      ctx.arc(this.boss.x, this.boss.y, this.boss.radius + 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
  } else if (this.boss.state === 'ACTIVE') {
      // Large HP bar above boss
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#222';
      ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240, 22);
  ctx.fillStyle = '#f00';
  // Use dynamic maxHp instead of a hard-coded denominator so bar reflects real progress
  const hpPctRaw = this.boss.maxHp > 0 ? this.boss.hp / this.boss.maxHp : 0;
  const hpPct = Math.min(1, Math.max(0, hpPctRaw));
  ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240 * hpPct, 22);
      ctx.font = 'bold 18px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS HP', this.boss.x, this.boss.y - this.boss.radius - 44);
      ctx.restore();
      // Boss body with damage flash and shake
      ctx.save();
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.boss._damageFlash * 2);
        ctx.translate((Math.random()-0.5)*8, (Math.random()-0.5)*8);
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 48;
      }
      if (this.bossImage) {
  const size = this.boss.radius*2;
  const bAny: any = this.boss as any;
  const faceLeft = (bAny._facingX ?? ((this.player.x < this.boss.x) ? -1 : 1)) < 0;
        ctx.save();
        ctx.translate(this.boss.x, this.boss.y);
  // Compose movement-facing flip with walk-cycle flip
  const flipX = (faceLeft ? -1 : 1) * (this.bossWalkFlip ? -1 : 1);
  if (flipX < 0) ctx.scale(-1, 1);
        ctx.drawImage(this.bossImage, -size/2, -size/2, size, size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(this.boss.x, this.boss.y, this.boss.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD700';
        ctx.fill();
      }
      ctx.restore();
      // Eye overlay suppressed when using boss image (eyes baked into PNG)
      if (!this.bossImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.boss.x-48, this.boss.y-32, 24, 0, Math.PI*2);
        ctx.arc(this.boss.x+48, this.boss.y-32, 24, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#FF00FF';
        ctx.shadowBlur = 32;
        ctx.globalAlpha = 0.9 + 0.1*Math.sin(Date.now()/200);
        ctx.fill();
        ctx.restore();
      }
      // Spell telegraphs and effects
      if (this.spellState === 'NOVA_CHARGE' || this.spellState === 'NOVA_RELEASE') {
        const t = this.spellState === 'NOVA_CHARGE' ? Math.min(1, this.spellTimerMs / 900) : Math.min(1, this.spellTimerMs / 900);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        // Charge glow
        ctx.globalAlpha = 0.18 + 0.22 * t;
        ctx.fillStyle = '#B266FF';
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, this.boss.radius + 40 + 10 * Math.sin(performance.now()*0.02), 0, Math.PI*2); ctx.fill();
        // Ring
        const r = (this.spellState === 'NOVA_RELEASE') ? this.novaRadius : (this.boss.radius + 50 + 120 * t);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#CC66FF';
        ctx.shadowColor = '#CC66FF';
        ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      if (this.spellState === 'LINEUP' || this.spellState === 'DASH') {
        // Floor telegraph line in dash direction
        const len = 520;
        const t = Math.min(1, (this.spellTimerMs / 600));
        const alpha = this.spellState === 'LINEUP' ? (0.15 + 0.35 * t) : 0.22;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#FF3366';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#FF99AA';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(this.boss.x, this.boss.y);
        ctx.lineTo(this.boss.x + this.dashDirX * len, this.boss.y + this.dashDirY * len);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // --- Spells ---
  private startShockNova() {
    if (!this.boss) return;
    this.spellState = 'NOVA_CHARGE';
    this.spellTimerMs = 0;
    this.novaRadius = 0;
    this.novaHitApplied = false;
  }

  private startLineDash(dx: number, dy: number, dist: number) {
    if (!this.boss) return;
    if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
    this.dashDirX = dx / dist;
    this.dashDirY = dy / dist;
    this.spellState = 'LINEUP';
    this.spellTimerMs = 0;
    this.dashElapsedMs = 0;
  this.dashDidHitOnce = false;
  }

  private updateSpells(dtMs: number) {
    if (!this.boss) return;
    switch (this.spellState) {
      case 'NOVA_CHARGE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 900) {
          this.spellState = 'NOVA_RELEASE';
          this.spellTimerMs = 0;
          // Inner blast damage near boss center
          const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
          if (d <= this.boss.radius + 60) {
            const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
            this.player.hp -= Math.round(45 * specialScale); // reduced inner blast damage
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 180, intensity: 6 } }));
          }
        }
        break;
      }
      case 'NOVA_RELEASE': {
        this.spellTimerMs += dtMs;
        const t = Math.min(1, this.spellTimerMs / 900);
        const inner = this.boss.radius + 60;
        this.novaRadius = inner + (this.novaMaxRadius - inner) * t;
        const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
        const band = 12; // narrower hit band
        if (!this.novaHitApplied && d >= this.novaRadius - band && d <= this.novaRadius + band) {
          this.novaHitApplied = true;
          const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
          this.player.hp -= Math.round(35 * specialScale); // reduced ring damage
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 5 } }));
        }
        if (t >= 1) this.endSpellCooldown();
        break;
      }
      case 'LINEUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 750) { // longer telegraph
          this.spellState = 'DASH';
          this.spellTimerMs = 0;
          this.dashElapsedMs = 0;
          this.dashDidHitOnce = false;
        }
        break;
      }
      case 'DASH': {
        const step = this.dashSpeedPxPerMs * dtMs;
        this.boss.x += this.dashDirX * step;
        this.boss.y += this.dashDirY * step;
        this.dashElapsedMs += dtMs;
        // Clamp to walkable area
        const rm = (window as any).__roomManager;
        if (rm && typeof rm.clampToWalkable === 'function') {
          const c = rm.clampToWalkable(this.boss.x, this.boss.y, this.boss.radius || 80);
          this.boss.x = c.x; this.boss.y = c.y;
        }
        // Contact damage during dash
        const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
        if (!this.dashDidHitOnce && d < this.player.radius + this.boss.radius) {
          this.dashDidHitOnce = true; // only once per dash
          this.player.hp -= 25; // reduced dash contact damage
          // Apply a moderate knockback to give recovery space
          if (d > 0) {
            const nx = (this.player.x - this.boss.x) / d;
            const ny = (this.player.y - this.boss.y) / d;
            this.player.x += nx * 72;
            this.player.y += ny * 72;
          }
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 5 } }));
        }
        if (this.dashElapsedMs >= this.dashDurationMs) {
          // Start short recovery: suppress body-checks right after dash
          this.postDashRecoverUntilMs = performance.now() + 380;
          this.endSpellCooldown();
        }
        break;
      }
    }
  }

  private endSpellCooldown() {
    this.spellState = 'IDLE';
    this.spellTimerMs = 0;
    this.novaHitApplied = false;
    this.nextSpellAtMs = performance.now() + this.spellCooldownMs;
  this.dashDidHitOnce = false;
  }

  public getActiveBoss() {
    return this.boss && this.boss.state === 'ACTIVE' ? this.boss : null;
  }

  /** Compatibility alias for existing callers. */
  public getBoss() {
    return this.getActiveBoss();
  }

  public setDifficulty(d: number) {
    this.difficulty = d;
    this.spawnTimer = Math.max(600, 1800 - (d - 1) * 300);
  }
}
