# Changelog

All notable changes to this project will be documented in this file.

Format: Keep a Changelog style with semantic, grouped bullets. Dates are in YYYY-MM-DD.

## [Unreleased]

- feat(bio): Add Bio Engineer class ability “Outbreak!” — 5s duration, 15s cooldown, forces 100% poison virality within 300px (scaled by Area). Visual green ring during active window.
- ui(hud): Add Bio Engineer Outbreak class bar (shows READY/ACTIVE/CD). 🎛️
- fix(bio): Bio Toxin puddles now scale with weapon level and Area multiplier on both impact and expiry for consistent size and lifetime.
- bal(bio): Bio Toxin projectiles no longer deal impact damage; they only spawn puddles on hit/expiry. DoT carries all damage.
- tweak(psionic): Dimmed psionic debuff (mark) glow—smaller radius, thinner ring, and lower alpha for less visual noise.
- fix(weapon): Akimbo Deagle bullets rendered with 180° wrong sprite rotation—added rotationOffset so art faces travel direction.

## [0.4.1] - 2025-08-31 — Titan Siege Patch

Highlights

- Titan Mech overhaul: Fortress Stance is now a spectacle with seismic stomps, clear size-up, and dark‑red theming. Mech Mortar evolves into the Siege Howitzer ultimate.
- Difficulty upshift: bosses are tankier with tighter spell cadence, and enemy pressure ramps much harder across a 15‑minute run.

Added

- titan(fortress): Seismic Stomp triggers once per second while Fortress is active (4s window). 500px radius, heavy damage, strong radial knockback, and dramatic screen shake with dark‑red shockwaves. Scales with Area and Damage.
- ui(icons): Replaced passive icons with a gritty cyan‑on‑dark set:
  - Speed = triple arrows to the right (wild shape)
  - Slow = triple arrows to the left
  - Magnet = upright U with a hollow center

Changed

- titan(fortress): Clear size gain—Titan grows +25% during Fortress with a smooth tween; all Fortress‑tied VFX/HUD accents are dark red.
- titan(offense): During Fortress, offensive boosts apply for the window: faster fire cadence, increased damage, and longer effective range for class weapons.
- titan(collisions): Mortar/Howitzer rounds can hit point‑blank—removed minimum collision/arming gates; continuous swept collision prevents tunneling at close range.

Evolved/Balance

- titan(evolution): Mech Mortar capped at level 7 and now evolves into Siege Howitzer. Howitzer shells have larger explosions and improved trails.
- boss(difficulty): Base boss HP tripled (x3). Idle windows between spells shortened and overall cadence tightened.
- enemies(ramp): Enemy pressure curve steepened—linear and quadratic terms increased so the 15‑minute ramp hits much harder.

Systems and Parity

- weapons(parity): Siege Howitzer now spawns from side barrels, accelerates properly, collides reliably, and explodes on range expiry and on impact (full parity with Mortar).
- explosions: Centralized implosion/explosion/shockwave handling; added pooling and adaptive VFX density. Mortar detonations use multi‑phase shockwaves plus a brief residual burn zone.
- boss(parity): Shockwaves/explosions correctly damage bosses via the centralized boss damage path; camera shake is routed consistently.

Fixes

- titan(close‑range): Fixed shells failing to register at melee distance; removed arming delays and applied segment‑sweep collision.
- titan(visuals): Fortress size‑up now visibly applies; HUD/meter switches to dark‑red during active.
- siege(howitzer): Addressed shots spawning from the center and not exploding; ensured both collision‑triggered and range‑expiry explosions fire.

Performance

- vfx(pooling): Shockwave rings and AoE zones use small pools with early returns in low‑FX mode; inner loops use classic for‑loops and cached lookups.
- explosions: Reduced overdraw and tuned lifetimes/alpha to keep clarity without tanking FPS; explosion debris counts adapt to frame time.

## [0.4.0] - 2025-08-30 — Evolution Patch

Highlights

- Evolution and parity sweep across weapons, beams, AoE, and boss/treasure interactions.
- New passives and a cinematic, safe revive experience.

Added

- passive(armor): Flat damage reduction applied pre‑HP; value listed in Codex.
- passive(revive): One‑time revive with 5m cooldown; restores 60% HP and grants brief i‑frames.
- passive(slow‑aura): Constant slow field around the player; scales with Area.

Evolved/Balance

- bio(living‑sludge): Puddle merge much easier with a soft cap around 800px; puddles slow targets by 20%.
- bio(living‑sludge): Evolved sludge crawls; movement speed set to 40% of base while in sludge.
- bio(poison): Infinite poison stacking enabled when using Living Sludge evolution; DoT level curve steepened when evolved.
- evo(gating): Fixed Serpent Chain evolution requirements; now offered only when prerequisites are met.

Systems and Parity

- revive: 5s “angelic” cinematic — freezes simulation, disables inputs, grants invulnerability, spawns a “soul” visual, and ends with a viewport detonation clearing the screen.
- safety: Suppressed boss/enemy contact and knockbacks during revive; boss respects global freeze/invulnerability.
- boss(parity): Centralized boss damage via EnemyManager.takeBossDamage; ensured AoE zones, explosions, shockwaves, Titan Mortar, and plasma detonation all damage the boss.
- beams(parity): Ghost Sniper, Void Sniper, and Railgun now route boss hits through the centralized path; Railgun adds boss intersection; Void Sniper passes correct parameters and applies immediate DoT tick.
- treasure(parity): Beams, pulses, AoE zones, explosions, shockwaves, and Titan Mortar consistently damage treasures.
- cleanup: Removed remaining direct boss.hp mutations in projectile/beam code paths.

UI/Docs

- codex: Filled values for new passives and evolutions; clarified labels and effects.
- main‑menu: Patch notes panel updated and version tag set to 0.4.0.

Performance

- enemy/beam: Micro‑optimizations in hot loops (query reuse, guard checks, allocation avoidance, classic for‑loops in inner paths).


## [0.3.1] - 2025-08-27

- feat(weaver): Resonant Web implemented as persistent orbitals with radial pulses, mark refresh, and polygon web rendering. Orbs are collisionless like Quantum Halo.
- feat(weaver): Each web orb auto-casts Level 7 Psionic Wave, prefers psionic‑marked targets; normal ricochet behavior restored.
- feat(weaver): Firing is gated to nearby threats—auto-casts only occur if an enemy or boss is within 800px of the player; boss is considered in targeting and proximity.
- feat(weaver+ui): Lattice triples web auto-cast fire rate for the duration and applies a dark‑purple theme: web orbs, connecting polygon, and web‑fired waves are tinted.
- ui(hud): During Lattice, Psionic Weaver’s left stats panel and class bar adopt a dark‑purple accent theme.
- fix(weaver): Prevent standard projectile spawn for Resonant Web (managed by orbit system) and ensure orbs don’t collide.
- fix(treasure): Resonant Web orbiting orbs now pass through treasures without colliding. Web pulses and web‑fired waves deal damage to treasures as intended.
- fix(evolution): Corrected Psionic Wave → Resonant Web evolution requirement to 'Area Up' (previously mislabeled 'AoE'). Evolution now offers correctly when Wave is maxed and Area Up ≥ Lv1.
- perf: Orbit updates use per‑frame guards and avoid allocations in inner loops.

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
