/**
 * Global performance feature flags and thresholds.
 * Enable carefully; defaults preserve current behavior.
 */
export const PerfFlags = {
  // Use the HighCapacityEnemyManager subclass instead of the base EnemyManager
  useHighCapacityEnemyManager: true,
  // Run basic SoA kinematics for far enemies (guarded; off by default until validated)
  enableSoAKinematics: false,
  // Attempt to use a SharedArrayBuffer worker pool for SoA updates
  enableWorkerSoA: false,
  // Attempt to use WebGL2 GPU compute/TF for kinematics
  enableGPUCompute: false,
  // When GPU compute is enabled, reduce readback pressure by syncing every N frames (>=1)
  gpuReadbackIntervalFrames: 3,
  // LOD configuration (renderer)
  lodEnabled: true,
  lodNearDistance: 400,   // switch to level 1 above this
  lodFarDistance: 800,    // switch to level 2 above this
  lodImposterEnabled: true,
  lodImposterSize: 32,
  // Adaptive skipping when overloaded
  lodSkipFarAtAvgMs: 35,  // if avgFrameMs > 35ms, skip far by ratio
  lodSkipFarRatio: 0.7,   // skip 70% of far when overloaded
  lodSkipMediumAtAvgMs: 50, // if avgFrameMs > 50ms, skip medium+ by ratio
  lodSkipMediumRatio: 0.5,
  // Optional: draw near/mid and far in separate instanced draws
  lodDrawBuckets: false,
  // Switch to high-capacity SoA path above this enemy count (when enabled)
  highCapacityThreshold: 2500,
} as const;

export type PerfFlags = typeof PerfFlags;
