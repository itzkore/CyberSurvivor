# CyberSurvivor Gameplay Guide (v0.2.9)

This document explains core game elements: characters, weapons, passives, stats, scaling rules, and pacing. It reflects the current TypeScript codebase as of 0.2.9.

Note: Beam weapon is temporarily disabled in 0.2.9 while it’s reworked.

## Overview

- Modes: Showdown (open arena) and Dungeon (structured map generation).
- Loop: Fixed timestep (~16.67 ms) rendered via requestAnimationFrame.
- Entities: Lightweight ECS; gameplay uses canvas only (no DOM inside the loop).
- Audio/FX: Howler/WebAudio SFX, canvas particles and overlays.

## Core Stats and Formulas

- Character base stats: hp, maxHp, speed, damage, strength, intelligence, agility, luck, defense.
- Derived metrics:
  - Survivability ≈ hp × (1 + defense / 50)
  - Crit baseline ≈ clamp((agility × 0.8 + luck × 1.2) × 0.5, max 60%)
  - Power score ≈ round(damage × 1.8 + strength × 1.2 + intelligence × 1.4 + agility × 1.1 + luck × 0.9 + defense × 0.8 + speed × 3)
- Pacing & progression:
  - Boss spawns: every 180 seconds (~3m, 6m, 9m)
  - Enemy pressure: 100 + 50×minutes + 18×minutes²
  - XP economy: gem drop chance small 35%, medium 55%, large 80%
  - Upgrade frequency: scaled to 60% of prior baseline
  - Level XP curve: nextExp(level) = 6 + 3×n + floor(0.40×n²), n = level − 1
  - Gem TTL: 90s
- Movement: SPEED_SCALE = 0.45 converts sheet speed to in‑game units.

## Characters

Each character has a default class weapon, curated weapon pool, and a unique statline. Base stats below; gameplay further modifies via passives, evolutions, and weapon levels.

- Wasteland Scavenger (default: Scrap‑Saw)
  - Base: HP 100, Speed 8.0, Damage 23, Str 6, Int 6, Agi 7, Luck 8, Def 5
  - Ability: Scrap Surge—build scrap with hits; trigger a defensive blast, heal +5 HP
  - Pool: Scrap‑Saw, Ricochet, Shotgun
  - Style: Balanced
- Tech Warrior (default: Tachyon Spear)
  - Base: HP 125, Speed 7.2, Damage 25, Str 8, Int 8, Agi 6, Luck 6, Def 8
  - Ability: Tech Sync—faster reload/firing with advanced weapons
  - Pool: Warrior Cannon, Tri‑Shot, Plasma, Tachyon Spear, Singularity Spear
  - Style: Aggressive
- Heavy Gunner (default: Minigun)
  - Base: HP 150, Speed 5.6, Damage 27, Str 9, Int 4, Agi 3, Luck 5, Def 9
  - Ability: Suppression Matrix—sustained fire slows enemies
  - Pool: Minigun, Shotgun, Mech Mortar
  - Style: Aggressive
- Cyber Runner (default: Runner Gun)
  - Base: HP 90, Speed 9.8, Damage 21, Str 5, Int 7, Agi 11, Luck 8, Def 4
  - Ability: Vector Dash—level‑scaled dash with brief i‑frames and afterimages
  - Pool: Runner Gun, Ricochet, Plasma
  - Style: Stealth
- Bio Engineer (default: Bio Toxin)
  - Base: HP 110, Speed 6.9, Damage 24, Str 5, Int 10, Agi 6, Luck 6, Def 6
  - Ability: Bio Hazard—weapons apply DoT
  - Pool: Bio Toxin, Plasma, Shotgun
  - Style: Support
- Data Sorcerer (default: Data Sigil)
  - Base: HP 95, Speed 8.4, Damage 28, Str 4, Int 10, Agi 7, Luck 9, Def 5
  - Ability: Sigilweave—place a rotating glyph that pulses shockwaves
  - Pool: Data Sigil, Arcane Orb, Plasma, Triple Crossbow
  - Style: Support
- Ghost Operative (default: Ghost Sniper)
  - Base: HP 80, Speed 9.0, Damage 42, Str 6, Int 8, Agi 10, Luck 9, Def 3
  - Ability: Phase Cloak—temporary invisibility and damage immunity
  - Pool: Ghost Sniper, Ricochet, Triple Crossbow
  - Style: Stealth
- Neural Nomad (default: Neural Threader)
  - Base: HP 105, Speed 7.6, Damage 26, Str 5, Int 9, Agi 7, Luck 8, Def 6
  - Ability: Neural Storm—area‑effect psychic blast
  - Pool: Neural Threader, Plasma
  - Style: Support
- Psionic Weaver (default: Psionic Wave)
  - Base: HP 115, Speed 7.4, Damage 28, Str 6, Int 9, Agi 6, Luck 7, Def 7
  - Ability: Energy Weave—homing and piercing effects
  - Pool: Psionic Wave, Plasma, Triple Crossbow
  - Style: Balanced
- Rogue Hacker (default: Hacker Virus)
  - Base: HP 100, Speed 8.2, Damage 25, Str 5, Int 10, Agi 8, Luck 9, Def 5
  - Ability: System Hack—temporarily disables enemy abilities
  - Pool: Hacker Virus, Triple Crossbow, Ricochet
  - Style: Support
- Shadow Operative (default: Void Sniper)
  - Base: HP 110, Speed 8.6, Damage 30, Str 7, Int 8, Agi 9, Luck 6, Def 6
  - Ability: Ebon Bleed—crits apply stacking void DoT
  - Pool: Void Sniper, Shadow Dagger, Ricochet, Triple Crossbow
  - Style: Aggressive
- Titan Mech (default: Mech Mortar)
  - Base: HP 180, Speed 5.0, Damage 34, Str 10, Int 6, Agi 2, Luck 4, Def 11
  - Ability: Armor Plating—reduced damage taken
  - Pool: Mech Mortar, Minigun, Shotgun
  - Style: Defensive

## Weapons

Weapons define base stats and a level‑scaling function. DPS goals are achieved via damage growth + cooldown improvements and, when relevant, salvo/spread adjustments.

Legend: cooldown (frames unless “ms”), salvo (projectiles per shot), range (px), speed (px/frame), traits.

- Desert Eagle (PISTOL)
  - Base: cd 70, salvo 1, range 660, dmg 58, speed 14, knockback 32
  - Scaling: targets DPS milestones; slight projectile size growth and pierce up to 3
  - Tips: long lanes, elite timing, early cooldown upgrades
- Shotgun (SHOTGUN)
  - Base: cd 95, salvo 5, spread 0.22, range 200, dmg 9, knockback 48
  - Scaling: tighter spread, more pellets (to 10), higher damage; strong full‑hit DPS
  - Tips: fight close; corridors; hug large targets
- Triple Crossbow (TRI_SHOT)
  - Base: cd 100, salvo 3, spread 0.155, range 620, dmg 22, knockback 26
  - Scaling: cd↓, salvo→5, spread tightens, speed/range↑, pierce→6
  - Tips: line up pierce lanes
- Smart Rifle (RAPID)
  - Base: cd 42, salvo 1, range 1400, dmg 18
  - Scaling: cd↓, dmg↑, salvo→2 later, turn rate↑; exponential in‑flight speed ramp
  - Tips: proximity tightens homing; boss focus
- Laser Blaster (LASER)
  - Base: cd 70, salvo 3, spread 0.035, range 1100, dmg 27
  - Scaling: per‑bolt damage↑; cd↓; burn stacks
  - Tips: stagger steps; focus for burn stacks
- Beam (BEAM)
  - Status: disabled in 0.2.9 (single‑target ramping beam under rework)
- Ricochet (RICOCHET)
  - Base: cd 70, salvo 1, range 420, dmg 12, knockback 18
  - Scaling: damage→~72, cd −20%, bounces 3→9
  - Tips: fire into clumps; herd for reliable chains
- Kamikaze Drone (HOMING)
  - Base: cd 120, salvo 1, range 150, dmg 40
  - Scaling: geometric damage 40→700, cd −10% total
  - Tips: launch early; guided‑grenade behavior
- Railgun (RAILGUN)
  - Base: cd 120, salvo 1, beam length 260, dmg 50
  - Scaling: extreme burst; damage↑, beam length↑; cd slightly↓
  - Tips: pre‑aim during charge; pierces
- Plasma Core (PLASMA)
  - Base: cd 90, dmg 38; charge 450ms; ion field DoT
  - Scaling: damage↑, cd↓, fragments↑
  - Tips: detonate in crowds; fields tick lingering damage
- Runner Gun (RUNNER_GUN)
  - Base: cd 12, salvo 2, spread 0.12, range 360, dmg 6
  - Scaling: linear damage↑, cd↓; built for motion
  - Tips: fight within ~360px; strafe while firing
- Warrior Cannon (WARRIOR_CANNON)
  - Base: cd 60, dmg 60, range 250; explosive
  - Scaling: damage↑, cd↓; class weapon
- Tachyon Spear (TACHYON_SPEAR) → Singularity Spear (requires Overclock)
  - Base: cd 48, dmg 42, range 680; piercing dash‑lance
  - Scaling: damage/length/speed↑, cd↓
- Singularity Spear (SINGULARITY_SPEAR)
  - Base: cd 64, dmg 66, range 720; implodes then explodes; gravity ring
  - Scaling: damage/length/speed↑, cd↓
- Arcane Orb (SORCERER_ORB)
  - Base: cd 144, dmg 144; piercing, homing, returns
  - Scaling: damage↑, cd↓; class weapon
- Data Sigil (DATA_SIGIL)
  - Base: cd 72, dmg 28; rotating glyph pulses
  - Scaling: pulse dmg 20→200, pulses 2→5, radius↑; cd↓, dmg↑
- Shadow Dagger (SHADOW_DAGGER)
  - Base: cd 18, dmg 18; ricochet/crit synergy
  - Scaling: damage↑, cd↓
- Bio Toxin (BIO_TOXIN)
  - Base: cd 88, dmg 44; lobbed pools with DoT
  - Scaling: damage↑, cd↓ up to ~40%
- Hacker Virus (HACKER_VIRUS)
  - Base: cd 32, dmg 32; EMP/disrupt; pierces
  - Scaling: damage↑, cd↓; class weapon
- Minigun (GUNNER_MINIGUN)
  - Base: cd 10, dmg 10, spread 0.22, range 320
  - Scaling: damage↑, cd↓; sustained spray, suppression
- Psionic Wave (PSIONIC_WAVE)
  - Base: cd 28, dmg 28; sweep beam; pierce+slow; marks target
  - Scaling: damage↑, cd↓; “mark” windows for burst
// NOTE: Legacy weapon "Scavenger Sling" has been removed. Scavenger class uses Scrap‑Saw → Industrial Grinder evolution.
- Neural Threader (NOMAD_NEURAL)
  - Base: cd 64, dmg 26, range 720; anchors threads that pulse
  - Scaling: anchors 2→8, thread life↑, pulse interval↓, pulse %↑
- Ghost Sniper (GHOST_SNIPER)
  - Base: cd 95, dmg 95; laser pierce; armor pierce
  - Scaling: damage↑, cd↓
- Void Sniper (VOID_SNIPER)
  - Base: cd 95, dmg 95; DoT‑only variant; brief paralysis
  - Scaling: damage↑, cd↓; ticks over time
- Mech Mortar (MECH_MORTAR)
  - Base: cd 90, dmg 90, radius 200; arcing AoE
  - Scaling: damage↑, cd↓, radius≈ +12%/lvl
- Quantum Halo (QUANTUM_HALO)
  - Base: persistent orbs (cooldown unused); orbiting blades that pulse/knock back
  - Scaling: orbs 2→5; orbit radius↑ (~+10% compounding); spin↑; pulse damage unlocks late
- Scrap‑Saw (SCRAP_SAW) → Industrial Grinder (requires Magnet)
  - Base: cd 930ms, dmg 32, reach 140; arc sweep + tether line (50% damage)
  - Scaling: larger arc/longer sweep; more shrapnel; higher knockback; scrap stacks trigger big blast + heal +5 HP
- Industrial Grinder (INDUSTRIAL_GRINDER)
  - Base: cd 180; sustained orbit; dmg 20; strong knockback
  - Scaling: duration↑, orbit radius↑, damage↑

## Passives

Max level and scaling model:

- Speed Boost (max 7): speed = base + 0.5 × level
- Max HP (max 7): +20 HP/level (1–5), then +15/level; heals 55% of added HP
- Damage Up (max 7): globalDamageMultiplier = 1 + 0.14 × level
- Fire Rate (max 7): fireRateModifier = 1 + 0.13 × level
- AOE On Kill (max 1): enemies explode on death
- Magnet (max 5): pickup radius = 120 + 36 × level
- Shield (max 5): shieldChance = min(50%, 5.5% × level)
- Crit (max 7): critBonus up to 55%; critMultiplier up to 3.1×
- Piercing (max 3): bullets pierce level additional enemies (1→3)
- Regen (max 7): 0.125×min(level,5) + 0.09×max(0, level−5)
- Area Up (max 3): globalAreaMultiplier = 1 + 0.10 × level

## Upgrades, Rerolls, Selection

- Upgrade offers exclude disabled weapons (e.g., Beam in 0.2.9).
- Character weapon pools shape offers alongside global weapons.
- Rerolls reset on new run; the game emits a “start run” event and UI clears rerolls.
- Evolutions require passives (e.g., Tachyon → Singularity needs Overclock; Scrap‑Saw → Grinder needs Magnet).

## Combat and Targeting

- Aim mode: Closest (default) or Toughest (HUD toggle). Targeting respects max weapon range.
- Damage: Most per‑level damage is derived from target DPS tables and cooldown; some weapons tick/ramp.
- Knockback: Per‑weapon spec; melee/shotgun‑class tends to be high.

## Visuals, FX, Performance

- Brightness: Railgun tuned so it doesn’t brighten the whole screen.
- Beam visuals: clamped to target; glow toned down; RGB ramp explored (weapon disabled for now).
- Performance guardrails:
  - Preallocate arrays when sizes are known
  - Use classic for loops in hot paths
  - Reuse vectors; avoid per‑frame allocations in inner loops
- Logging: Logger.debug/info only; no console.log in production builds.

## Version Notes (0.2.9)

- Beam disabled globally pending rework.
- Smart Rifle: exponential in‑flight speed ramp; tighter homing.
- Neural Nomad: multi‑shot to nearest enemies; thread anchors/pulse scaling.
- Heavy Gunner: Overdrive/heat model buffed (uptime, cooldown, floor, multipliers).
- Data Sorcerer: AoE sigil scaling fixed; pulse damage 20→200; Area Up capped at 3.
- Boss cadence anchored; restart resets rerolls; main menu UX/SFX polish.

## Tips

- Stay within weapon range to maintain firing (e.g., Runner Gun ~360px).
- Use corridors/chokepoints for pierce and shotgun; pair slows/pulls with AoE.
- Early cooldown upgrades help single‑shot weapons; Area Up (to Lv3) benefits AoE builds.

---
If you notice discrepancies vs. gameplay, it may be due to recent changes. Please open an issue/PR with details.
