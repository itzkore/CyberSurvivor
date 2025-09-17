import { EnemyManager } from './EnemyManager';
import type { Enemy } from './EnemyManager';
import type { Bullet } from './Bullet';
import { Player } from './Player';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { SpatialGrid } from '../physics/SpatialGrid';
import { Logger } from '../core/Logger';
import { PerfFlags as Flags } from '../config/perfFlags';
import { TFKinematics } from '../render/gl/compute/TFKinematics';

/**
 * HighCapacityEnemyManager
 *
 * Drop-in subclass of EnemyManager that will gradually migrate logic
 * to SoA buffers, worker pool, and optional GPU compute.
 *
 * For now, it inherits behavior so we can wire it safely via flags
 * and evolve incrementally without breaking visuals.
 */
export class HighCapacityEnemyManager extends EnemyManager {
  // SoA buffers (scaffold) – allocated lazily when needed
  private soa: null | {
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    hp: Float32Array;
    radius: Float32Array;
    active: Uint8Array;
    type: Uint8Array; // map Enemy['type'] to small enums (0/1/2)
    count: number;
    capacity: number;
  } = null;

  private hasWorkers: boolean = false;
  private hasGPUCompute: boolean = false;
  private gpuTF: TFKinematics | null = null;
  private farMask: Uint8Array | null = null; // 1 = far, 0 = near/mid
  // Scratch buffers for packed far XY/VXY and index mapping
  private farIndexList: Uint32Array | null = null;
  private farPosXY: Float32Array | null = null;
  private farVelXY: Float32Array | null = null;
  private gpuFrameCounter = 0;

  constructor(
    player: Player,
    bulletGrid: SpatialGrid<Bullet>,
    particleManager: ParticleManager,
    assetLoader: AssetLoader,
    difficultyScale: number
  ) {
    super(player, bulletGrid, particleManager, assetLoader, difficultyScale);
    // Detect features but do not enable by default
    this.hasWorkers = Flags.enableWorkerSoA && typeof SharedArrayBuffer !== 'undefined';
    this.hasGPUCompute = Flags.enableGPUCompute && this.checkGLSupport();
    if (this.hasGPUCompute) {
      try { this.gpuTF = new TFKinematics(); } catch { this.gpuTF = null; this.hasGPUCompute = false; }
    }
  }

  /** Quick capability probe for GPU compute (WebGL2 presence only for now). */
  private checkGLSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      return !!gl;
    } catch {
      return false;
    }
  }

  /**
   * Ensure SoA capacity for a given count. Currently only scaffolds arrays;
   * real migration will populate from this.enemies and keep them in sync until
   * full parity is achieved.
   */
  private ensureSoACapacity(count: number) {
    if (this.soa && this.soa.capacity >= count) return;
    const capacity = Math.max(4096, 1 << Math.ceil(Math.log2(count + 32)));
    this.soa = {
      x: new Float32Array(capacity),
      y: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      hp: new Float32Array(capacity),
      radius: new Float32Array(capacity),
      active: new Uint8Array(capacity),
      type: new Uint8Array(capacity),
      count: 0,
      capacity,
    };
    // Resize mask alongside SoA
    this.farMask = new Uint8Array(capacity);
    // Resize scratch buffers
    this.farIndexList = new Uint32Array(capacity);
    this.farPosXY = new Float32Array(capacity * 2);
    this.farVelXY = new Float32Array(capacity * 2);
  }

  /** Mirror update; later we will branch into SoA/worker/GPU paths. */
  public override update(deltaTime: number, now: number, bullets: Bullet[]) {
    // Heuristic gate into SoA path (disabled until migrated)
    const enemyCount = (this as any).enemies?.length ?? 0;
    if (Flags.enableGPUCompute && this.hasGPUCompute && enemyCount > Flags.highCapacityThreshold) {
      // GPU compute path handled after base update using SoA + TF (positions only for far enemies)
    } else if (Flags.enableWorkerSoA && this.hasWorkers && enemyCount > Flags.highCapacityThreshold) {
      // TODO: Worker SoA path
      // For now, fall through to base behavior
    }

    // Base behavior first (ensures parity for near/critical logic)
    super.update(deltaTime, now, bullets);

    // Stage 1: Mirror Enemy[] into SoA buffers when large counts
    if (enemyCount > Flags.highCapacityThreshold) this.syncSoAFromEnemies();

    // Stage 2: Optional SoA kinematics for far enemies (guarded, off by default)
    if (Flags.enableGPUCompute && this.soa && this.soa.count > 0 && this.gpuTF) {
      try {
        this.updateFarMask();
        this.updateGPUKinematicsFar(deltaTime);
        // Amortize readback/sync to reduce CPU-GPU traffic
        this.gpuFrameCounter = (this.gpuFrameCounter + 1) | 0;
        const interval = Math.max(1, (Flags as any).gpuReadbackIntervalFrames ?? 1);
        if ((this.gpuFrameCounter % interval) === 0) {
          this.syncEnemiesPositionFromSoAWithMask();
        }
      } catch (e) {
        Logger.debug('[HC-EM] GPU TF kinematics failed, skipping this frame', e);
      }
    } else if (Flags.enableSoAKinematics && this.soa && this.soa.count > 0) {
      try {
        this.updateSoAKinematicsFar(deltaTime);
        // Sync only positions back to Enemy[] for rendering/collision
        this.syncEnemiesPositionFromSoAWithMask();
      } catch (e) {
        Logger.debug('[HC-EM] SoA kinematics failed, skipping this frame', e);
      }
    }
  }

  /**
   * Mirror the current Enemy[] into SoA buffers. Pure data copy; no behavior change.
   */
  private syncSoAFromEnemies() {
    const enemies = (this as any).enemies as Enemy[];
    const n = enemies.length | 0;
    if (n <= 0) return;
    this.ensureSoACapacity(n);
    if (!this.soa) return;
    const { x, y, vx, vy, hp, radius, active, type } = this.soa;
    // Fill SoA (classic for-loop for speed)
    for (let i = 0; i < n; i++) {
      const e = enemies[i];
      x[i] = e.x;
      y[i] = e.y;
      vx[i] = (e as any).vx || 0;
      vy[i] = (e as any).vy || 0;
      hp[i] = e.hp;
      radius[i] = e.radius;
      active[i] = e.active ? 1 : 0;
      // Map type to 0/1/2
      const t = e.type;
      type[i] = t === 'small' ? 0 : (t === 'medium' ? 1 : 2);
    }
    this.soa.count = n;
  }

  /**
   * Distance bucketing and simple kinematics for far enemies using SoA buffers.
   * Keeps near enemies governed by the detailed parent update (parity preserved).
   */
  private updateSoAKinematicsFar(deltaTime: number) {
    if (!this.soa) return;
    const enemies = (this as any).enemies as Enemy[];
    const n = this.soa.count | 0;
    if (n <= 0) return;

    // Player snapshot
    const px = (this as any).player?.x ?? 0;
    const py = (this as any).player?.y ?? 0;
    const dt = deltaTime > 0 ? deltaTime : 16;
    const dtSec = dt * 0.001;

    const { x, y, vx, vy, radius, active } = this.soa;

    // Thresholds (match EnemyManager.criticalRangeSq where possible)
    const criticalSq = ((this as any).criticalRangeSq ?? 40000) | 0; // ~200px^2
    const critical = Math.sqrt(criticalSq);
    const farStart = Math.max(critical * 1.6, 320); // begin far at >= ~320px
    const farStartSq = farStart * farStart;

    // Simple chase-like kinematics with cap similar to parent
    const chaseCapRatio = (this as any).enemyChaseCapRatio ?? 0.9;
    const pSpeed = Math.sqrt(((this as any).player?.vx || 0) ** 2 + ((this as any).player?.vy || 0) ** 2) || 0;
    const chaseCap = pSpeed > 0 ? pSpeed * chaseCapRatio : 180; // baseline cap

    // Update only far enemies; near enemies stay fully detailed by parent update
    const mask = this.farMask as Uint8Array;
    for (let i = 0; i < n; i++) {
      if (active[i] === 0) continue;
      const e = enemies[i]; if (!e || !e.active) continue;
      const dx = px - x[i]; const dy = py - y[i];
      const dSq = dx*dx + dy*dy;
      if (dSq < farStartSq) { mask[i] = 0; continue; } // leave near/mid to detailed path

      // steer toward player
      const d = dSq > 1 ? Math.sqrt(dSq) : 1;
      const inv = 1 / d;
      const targetSpeed = Math.min(chaseCap, Math.max(40, e.speed || 0));
      const svx = dx * inv * targetSpeed;
      const svy = dy * inv * targetSpeed;
      // critically damped blend (light)
      vx[i] = svx;
      vy[i] = svy;
      x[i] += vx[i] * dtSec;
      y[i] += vy[i] * dtSec;
      // simple boundary leash to reduce runaway
      const r = radius[i] || e.radius || 12;
      if (d <= r + 1) {
        x[i] -= vx[i] * dtSec * 0.5;
        y[i] -= vy[i] * dtSec * 0.5;
      }
      mask[i] = 1;
    }
  }

  /** Compute/update the far mask based on current player distance. */
  private updateFarMask() {
    if (!this.soa) return;
    const enemies = (this as any).enemies as Enemy[];
    const n = Math.min(enemies.length, this.soa.count);
    const mask = this.farMask as Uint8Array;
    const { x, y, active } = this.soa;
    const px = (this as any).player?.x ?? 0;
    const py = (this as any).player?.y ?? 0;
    const criticalSq = ((this as any).criticalRangeSq ?? 40000) | 0;
    const critical = Math.sqrt(criticalSq);
    const farStart = Math.max(critical * 1.6, 320);
    const farStartSq = farStart * farStart;
    for (let i = 0; i < n; i++) {
      if (active[i] === 0) { mask[i] = 0; continue; }
      const e = enemies[i]; if (!e || !e.active) { mask[i] = 0; continue; }
      const dx = px - x[i]; const dy = py - y[i];
      const dSq = dx*dx + dy*dy;
      mask[i] = dSq >= farStartSq ? 1 : 0;
    }
  }

  /** GPU TF update for far enemies only (positions-only integration). */
  private updateGPUKinematicsFar(deltaTime: number) {
    if (!this.soa || !this.gpuTF) return;
    const total = this.soa.count | 0; if (total <= 0) return;
    const mask = this.farMask as Uint8Array;
    const idxList = this.farIndexList as Uint32Array;
    const posXY = this.farPosXY as Float32Array;
    const velXY = this.farVelXY as Float32Array;
    const { x, y, vx, vy, active } = this.soa;
    // Compact far-active indices into packed arrays
    let farCount = 0;
    for (let i = 0; i < total; i++) {
      if (active[i] === 0 || mask[i] !== 1) continue;
      idxList[farCount] = i;
      const j = farCount * 2;
      posXY[j] = x[i]; posXY[j + 1] = y[i];
      velXY[j] = vx[i]; velXY[j + 1] = vy[i];
      farCount++;
    }
    if (farCount === 0) return;
    // Run TF only on farCount
    this.gpuTF.ensureCapacity(farCount);
    this.gpuTF.syncPacked(posXY, velXY, farCount);
    const dtSec = (deltaTime > 0 ? deltaTime : 16) * 0.001;
    this.gpuTF.update(dtSec, farCount);
    // Readback packed positions for farCount
    const out = this.gpuTF.readbackPositions(farCount);
    // Scatter back into SoA
    for (let k = 0, j = 0; k < farCount; k++, j += 2) {
      const i = idxList[k] | 0;
      x[i] = out[j]; y[i] = out[j + 1];
    }
  }

  /** Write back positions from SoA to Enemy[] for far indices only. */
  private syncEnemiesPositionFromSoAWithMask() {
    if (!this.soa) return;
    const enemies = (this as any).enemies as Enemy[];
    const n = Math.min(enemies.length, this.soa.count);
    const { x, y, active } = this.soa;
    const mask = this.farMask as Uint8Array;
    for (let i = 0; i < n; i++) {
      if (active[i] === 0 || mask[i] !== 1) continue;
      const e = enemies[i]; if (!e || !e.active) continue;
      e.x = x[i]; e.y = y[i];
    }
  }

}

export default HighCapacityEnemyManager;
