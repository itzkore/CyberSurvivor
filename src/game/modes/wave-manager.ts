import { loadJSON, lastStandData } from './config-loader';

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
            // Speed jitter per spawn for variety
            try {
              const mul = 0.9 + Math.random()*0.3; // 0.9x..1.2x
              e.speed = Math.max(0.05, e.speed * mul);
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
