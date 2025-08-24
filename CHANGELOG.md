# Changelog

All notable changes to this project will be documented in this file.

Format: Keep a Changelog style with semantic, grouped bullets. Dates are in YYYY-MM-DD.

## [Unreleased]

- feat(bio): Add Bio Engineer class ability “Outbreak!” — 5s duration, 15s cooldown, forces 100% poison virality within 300px (scaled by Area). Visual green ring during active window.
- ui(hud): Add Bio Engineer Outbreak class bar (shows READY/ACTIVE/CD). 🎛️
- fix(bio): Bio Toxin puddles now scale with weapon level and Area multiplier on both impact and expiry for consistent size and lifetime.
- bal(bio): Bio Toxin projectiles no longer deal impact damage; they only spawn puddles on hit/expiry. DoT carries all damage.

## [0.2.9] - 2025-08-24

- feat(balance): Heavy Gunner Overdrive buff; Smart Rifle speed ramp made exponential.
- feat(neural): Neural Nomad threads shared per player and prioritize psionic-marked targets; multi-target linking.
- chore(weapon): Beam disabled for now due to stability/UX concerns.
- fix(boss): Boss spawn cadence tied to elapsed time to ensure second boss spawns.
- fix(visuals): Prevent background from brightening after restarts and when firing railgun; environment reset/clamps.
- fix(qol): Rerolls reset correctly at start-of-run; return-to-menu issues addressed; main menu polish.
- docs(gameplay): Documented that Beam is disabled in this release.

---

Older changes prior to 0.2.9 were informal and are not listed here.
# Changelog

All notable changes to this project will be documented in this file.

## 0.2.0 — 2025-08-22

Highlights

- Ghost Operative: Phase Cloak now lasts 5s and has a 15s cooldown. Grants strong fade, damage immunity, and a speed boost while active.
- Enemy AI: During cloak, enemies pursue the player’s locked position taken at cloak start until cloak ends.
- HUD: Ghost now has two class bars (Sniper charge and Cloak status) with clear READY/ACTIVE/seconds readouts.
- Character Select: Theme aligned to the main menu (cyan/teal). Weapon info made useful with actionable tips and improved lore readability.

Added

- Weapon tips: usageTips added for key weapons; UI shows them, with a smart fallback tip generator when tips are absent.
- Cloak events: ghostCloakStart/ghostCloakEnd events dispatched for systems to react (AI follows locked position).

Changed

- Ghost Cloak: duration +2s (total 5s), cooldown lowered to 15s; strong visual fade while cloaked.
- Character Select styling: unified palette, improved hover/active states, and better lore text contrast.

Fixed

- Data Sorcerer special ability description corrected to match Sigil mechanics.

Performance

- EnemyManager micro-optimizations:
  - Cache performance.now() per frame.
  - Hoist chase speed cap and roomManager lookups out of inner loops.
  - Lighter math in the gem update loop (precomputed radii/distances).
- Knockback logic remains radial and capped to prevent runaway acceleration.

Known issues

- Font asset warnings: Orbitron font paths may show “didn’t resolve at build time” during Vite build; they resolve at runtime. Consider importing fonts through the Vite assets pipeline to silence warnings.

Notes

- No data/schema migrations required. Package.json reflects version 0.2.0.
