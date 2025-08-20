## Security Hardening Overview

### Implemented

1. Electron sandbox enabled (`sandbox: true`), `contextIsolation: true`, `enableRemoteModule: false`.
2. Minimal preload bridge exposing only `window.cs.meta` + `getEnvInfo()`; immutable via `Object.freeze`.
3. CSP (production): Self-only for scripts, styles, fonts, media, images (`data:` allowed for images only).
4. CSP (development): Experimentally removed `unsafe-eval`; if HMR breaks, re-add only for dev.
5. Self-host font placeholder; external Google Fonts removed.
6. GPU flags: aggressive profile restricted to development; production uses baseline subset.
7. Unit tests for balance (speed scaling, regen scaling, speed clamp) with window/navigator guards for Node.
8. Preload API version metadata & runtime integrity verification in `main.ts`.
9. Runtime performance drift monitor warns when avg frame delta > 22ms (approx <45 FPS).

### Pending / Recommended

1. Confirm dev HMR stability without `unsafe-eval`; revert for dev only if necessary.
2. Add actual Orbitron WOFF2 under `src/assets/fonts/` and verify load; remove placeholder comment.
3. Add automated dependency audit step (CI) and document accepted exceptions.
4. Implement code signing & update integrity verification (future release pipeline).
5. Add IPC channel schema validation (when IPC is introduced) and corresponding tests.
6. Extend tests: weapon evolution logic, AOE on kill, shield probability bounds.
7. Threat model doc enumerating renderer compromise scenarios & containment.

### Rollback (Dev CSP)

If dev server fails after removing `unsafe-eval`, modify `src/index.html` CSP meta to restore `'unsafe-eval'` in `script-src` for development only.

Generated during security hardening pass.
