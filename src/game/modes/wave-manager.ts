import { loadJSON, lastStandData } from './config-loader';

type WaveSpawn = { type: 'small'|'medium'|'large'; count: number };
export type WaveDef = { id: number; spawns: WaveSpawn[]; boss?: boolean };

export class WaveManager {
  private waves: WaveDef[] = [];
  private waveIndex = -1;
  private aliveInWave = 0;
  private onWaveCompleteCbs: Array<(index: number) => void> = [];

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

  /** Start the next wave by asking EnemyManager to spawn groups near player. */
  startNextWave(enemyManager: any, player: any) {
    this.waveIndex++;
    const wave = this.waves[this.waveIndex] || { id: this.waveIndex+1, spawns:[{type:'small',count:12+(this.waveIndex*5)}], boss: ((this.waveIndex+1)%5)===0 };
    let alive = 0;
    for (const s of wave.spawns) {
      for (let i=0;i<s.count;i++) {
        const ang = Math.random()*Math.PI*2; const r = 420 + Math.random()*220;
        const x = player.x + Math.cos(ang)*r; const y = player.y + Math.sin(ang)*r;
        const e = enemyManager.spawnEnemyAt?.(x, y, { type: s.type });
        if (e) alive++;
      }
    }
    this.aliveInWave = alive;
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
