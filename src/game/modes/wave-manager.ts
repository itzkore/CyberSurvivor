import { loadJSON, lastStandData } from './config-loader';
import { SPEED_SCALE } from '../Balance';

type WaveSpawn = { type: 'small'|'medium'|'large'; count: number };
export type WaveDef = { id: number; spawns: WaveSpawn[]; boss?: boolean };

export class WaveManager {
  private waves: WaveDef[] = [];
  private waveIndex = -1;
  private aliveInWave = 0;
  private onWaveCompleteCbs: Array<(index: number) => void> = [];
  private waveToken = 0; // increments each wave to cancel delayed spawns

  async load(): Promise<void> {
    try {
      const url = lastStandData.waves();
      const json = await loadJSON<{ waves: WaveDef[] }>(url);
      this.waves = json?.waves || [];
    } catch {
      // Fallback: simple procedural waves
      this.waves = [];
      for (let i=0;i<12;i++) {
        const base = 10 + i * 4;
        this.waves.push({ id: i+1, spawns: [ { type:'small', count: base }, { type:'medium', count: Math.floor(base*0.4) } ], boss: (i+1)%5===0 });
      }
    }
  }

  getCurrentWaveNumber(){ return this.waveIndex + 1; }
  getTotalWaves(){ return this.waves.length || 12; }
  getEnemiesRemaining(){ return Math.max(0, this.aliveInWave|0); }

  /** Start the next wave by asking EnemyManager to spawn groups.
   * Staggers spawns over time for better pacing.
   * Optional options.spawnPositionFn can override spawn positions (e.g., corridor right side).
   */
  startNextWave(enemyManager: any, player: any, options?: { spawnPositionFn?: (index:number, type: WaveSpawn['type']) => { x:number; y:number } }) {
  this.waveIndex++;
  this.waveToken++;
  const token = this.waveToken;
    const wave = this.waves[this.waveIndex] || { id: this.waveIndex+1, spawns:[{type:'small',count:12+(this.waveIndex*5)}], boss: ((this.waveIndex+1)%5)===0 };
  // Wave-based speed multiplier: Wave 1 = 2.0x, rises gently, and reaches its maximum at Wave 30
  // New curve: linear ramp from 2.0x at Wave 1 to 2.4x at Wave 30; clamped beyond 30
  // This tones down late-wave movement speeds (esp. beyond Wave 10) while preserving early urgency.
  const waveNum = this.waveIndex + 1;
  const t30 = Math.min(1, Math.max(0, (waveNum - 1) / 29)); // 0 at W1 -> 1 at W30
  const waveSpeedMul = 2.0 + 0.40 * t30; // 2.0 .. 2.4 (at W30+)
  // Absolute global cap: no enemy should exceed Ghost Operative default movement speed (9.0 scaled)
  const ghostCap = 9.0 * SPEED_SCALE; // ~4.05 units if SPEED_SCALE=0.45
  let alive = 0;
    let offsetMs = 0;
  // Faster pacing: tighten spawn cadence to feel more snappy
  const baseGap = 120; // ms between spawns baseline (was 180)
    for (const s of wave.spawns) {
      for (let i=0;i<s.count;i++) {
        const delay = offsetMs + Math.max(60, Math.round(baseGap * (0.85 + Math.random()*0.5)));
        setTimeout(() => {
          if (token !== this.waveToken) return; // stale timeout
          let x:number, y:number;
          if (options?.spawnPositionFn) {
            const p = options.spawnPositionFn(i, s.type);
            x = p.x; y = p.y;
          } else {
            const ang = Math.random()*Math.PI*2; const r = 640 + Math.random()*360; // push farther out of view
            x = player.x + Math.cos(ang)*r; y = player.y + Math.sin(ang)*r;
          }
          const e = enemyManager.spawnEnemyAt?.(x, y, { type: s.type });
          if (e) {
            // Apply wave speed scaling first, then add minor jitter for variety
            try { e.speed = Math.max(0.05, e.speed * waveSpeedMul); } catch { /* ignore */ }
            // Speed jitter per spawn for variety
            try {
              const mul = 0.9 + Math.random()*0.3; // 0.9x..1.2x
              e.speed = Math.max(0.05, e.speed * mul);
            } catch {/* ignore */}
            // Enforce per-type caps and global ghost cap after all scaling
            try {
              if (typeof enemyManager.clampToTypeCaps === 'function') {
                e.speed = enemyManager.clampToTypeCaps(e.speed, s.type);
              } else {
                // Fallback: at least clamp to global ghost cap
                if (e.speed > ghostCap) e.speed = ghostCap;
              }
            } catch {/* ignore */}
            this.aliveInWave++;
          } else {
            // failed spawn; no increment
          }
        }, delay);
        offsetMs += baseGap;
        // alive count tracks successful spawns only; do not pre-increment here to avoid desync
      }
    }
    // Reset alive counter to 0 and let successful spawns increment it to the correct value
    this.aliveInWave = 0;
    // Hint: boss waves are handled by LastStand controller using BossManager
  }

  /** Call when an enemy is defeated. */
  onEnemyDefeated(){
    if (this.aliveInWave > 0) this.aliveInWave--;
    if (this.aliveInWave <= 0) this.emitComplete();
  }

  onWaveComplete(cb:(index:number)=>void){ this.onWaveCompleteCbs.push(cb); }
  private emitComplete(){ for (const cb of this.onWaveCompleteCbs) try { cb(this.waveIndex); } catch {} }
}
