# Performance Audit (2025-08-19)

Goal: Unlock higher FPS headroom, reduce jank, lower GC pressure, and prepare path for GPU / worker offload.

## Changes Implemented

1. Electron GPU flags: Added optional `UNLOCK_FPS=1` path enabling `disable-frame-rate-limit` + `disable-gpu-vsync` (tearing risk). Default behavior unchanged.
2. GameLoop: Pre-bound loop function (no per-frame bind alloc), optional variable timestep mode, min/max delta clamps, backlog cap (`maxCatchUpFrames`), configurable Hz. Micro docs added.
3. SpatialGrid: Replaced string-key Map with nested numeric Maps; removed string concat and spread allocs; added scratch reuse array (non-retain contract documented).
4. Minor guardrails & documentation for future optimization toggles.

## Recommended Next Steps

Short-term (Low Risk):

- Bullet & Enemy broad-phase: Avoid per-frame `Math.hypot` where possible; compare squared distances first.
- Pool CustomEvents or replace with lightweight in-process dispatcher for hot events like damage (currently alloc each hit).
- Convert frequent `Math.random()` usage in tight loops to a fast LCG PRNG when deterministic seeding is desired.
- Collapse multiple `ctx.save/restore` in bullet draw loops by grouping same styles.

Mid-term (Medium Risk):

- Migrate rendering to OffscreenCanvas worker (partial path exists in `renderWorker.ts`); send structured, packed Float32Array buffers instead of object arrays.
- Introduce texture atlas & WebGL/WebGPU path (2D sprite batch) to offload CPU rasterization costs.
- Implement dynamic quality scaler using moving 95th percentile frame time (already tracked) to downscale resolution aggressively under load.

Long-term (Higher Effort):

- ECS refactor: Separate pure data arrays (SoA) for enemy positions, velocities, radii, HP to enable SIMD / WebAssembly acceleration.
- Path for WebGPU compute culling of far / off-screen entities.
- Replace manual spatial grid with uniform grid + fixed-size buckets or hashed integer indexing for faster clear/insert.

## Runtime Flags / Env

Env (Electron main process):

- `GFX=baseline|minimal|aggressive` existing profiles.
- `UNLOCK_FPS=1` unlocks vsync/frame limit (power usage ↑, potential tearing).

JS (Dev console):

- `__noDynScale` toggle dynamic resolution.
- `__lowFX` toggle simplified effects.
- `__simpleRender` ultra-minimal render path.
- `?worker=1` URL param enables OffscreenCanvas experimental worker renderer (falls back silently if unsupported).

## Potential Metrics to Track (Add Later)

- Frame pacing: stddev of frame deltas, existing p95.
- Logic update budget vs render budget (ms per bucket) with rolling averages.
- Object pool usage & expansion counts.

## Notes

SpatialGrid query now returns an internally reused array. Callers must process immediately. If retention needed, copy (`slice()`). Ensure all current call sites comply (bullet & enemy collision use immediate iteration – OK).

GameLoop variable timestep mode retained but not yet wired; enable via constructor option once systems use delta scaling (currently fixed-step logic expects constant 16.67ms).

---
Feel free to request wiring variable timestep, OffscreenCanvas full integration, or WebGL batch renderer next.
