# CyberSurvivor Game Data Catalog (DB Prep)

Generated: 2025-08-24

This document enumerates all Operatives, Weapons, and Passives with base stats, traits, and explicit level scaling to support a future database schema. Values are sourced from the current repository code (WeaponConfig.ts, characters.ts, PassiveConfig.ts). All level ranges are 1-based and clamped to their defined caps.

SECTIONS

- Operatives: core stats, derived stats, default weapon, loadouts
- Weapons: base props, traits, evolution, explicit getLevelStats scaling details
- Passives: description and numeric scaling / effects

OPERATIVES

- Important: the character stats include a generic "damage" attribute used for derived metrics, not the per-shot damage. Real hit damage comes from the equipped Weapon spec. For convenience, each operative below also lists the Default Weapon L1 hit damage summary.

- Wasteland Scavenger (id: wasteland_scavenger)
  - Playstyle: Balanced | Shape: square | Color: #808080 | Icon: /assets/player/wasteland_scavenger.png
  - Default Weapon: SCRAP_SAW
  - Loadout: SCRAP_SAW, SCAVENGER_SLING, RICOCHET, SHOTGUN
  - Base Stats: hp 100 | maxHp 100 | speed 8.0 | damage 23 | str 6 | int 6 | agi 7 | luck 8 | def 5
  - Derived: critChance ≈ 10 | survivability ≈ 110 | powerScore ≈ 117
  - Special: Scrap Surge — build scrap; blast + heal +5 HP
  - Default Weapon L1 damage: Scrap‑Saw blade 38 per hit; tether line ≈ 65% of blade; arc 140°; sweep duration 280ms

- Tech Warrior (id: tech_warrior)
  - Playstyle: Aggressive | Shape: square | Color: #4169E1 | Icon: /assets/player/tech_warrior.png
  - Default Weapon: TACHYON_SPEAR
  - Loadout: WARRIOR_CANNON, TRI_SHOT, PLASMA, TACHYON_SPEAR, SINGULARITY_SPEAR
  - Base Stats: hp 125 | maxHp 125 | speed 7.2 | damage 25 | str 8 | int 8 | agi 6 | luck 6 | def 8
  - Derived: critChance ≈ 9 | survivability ≈ 145 | powerScore ≈ 132
  - Special: Tech Sync — faster reload/firing with advanced weapons
  - Default Weapon L1 damage: Tachyon Spear 42 per pierce; length 100; speed 14

- Heavy Gunner (id: heavy_gunner)
  - Playstyle: Aggressive | Shape: square | Color: #8B4513 | Icon: /assets/player/heavy_gunner.png
  - Default Weapon: GUNNER_MINIGUN
  - Loadout: GUNNER_MINIGUN, SHOTGUN, MECH_MORTAR
  - Base Stats: hp 150 | maxHp 150 | speed 5.6 | damage 27 | str 9 | int 4 | agi 3 | luck 5 | def 9
  - Derived: critChance ≈ 7 | survivability ≈ 177 | powerScore ≈ 132
  - Special: Suppression Matrix — sustained fire slows enemies
  - Default Weapon L1 damage: Minigun 10 per shot; 1× salvo; cooldown 10f

- Cyber Runner (id: cyber_runner)
  - Playstyle: Stealth | Shape: triangle | Color: #00FF41 | Icon: /assets/player/cyber_runner.png
  - Default Weapon: RUNNER_GUN
  - Loadout: RUNNER_GUN, RICOCHET, PLASMA
  - Base Stats: hp 90 | maxHp 90 | speed 9.8 | damage 21 | str 5 | int 7 | agi 11 | luck 8 | def 4
  - Derived: critChance ≈ 12 | survivability ≈ 97 | powerScore ≈ 121
  - Special: Vector Dash — level-scaled dash with i-frames and afterimages
  - Default Weapon L1 damage: Runner Gun 6 per bullet; salvo 2 (≈12 per burst)

- Bio Engineer (id: bio_engineer)
  - Playstyle: Support | Shape: circle | Color: #39FF14 | Icon: /assets/player/bio_engineer.png
  - Default Weapon: BIO_TOXIN
  - Loadout: BIO_TOXIN, PLASMA, SHOTGUN
  - Base Stats: hp 110 | maxHp 110 | speed 6.9 | damage 24 | str 5 | int 10 | agi 6 | luck 6 | def 6
  - Derived: critChance ≈ 10 | survivability ≈ 123 | powerScore ≈ 127
  - Special: Bio Hazard — weapons apply DoT effects
  - Default Weapon L1 damage: Bio Toxin impact 0; damage comes from puddles/poison over time

- Data Sorcerer (id: data_sorcerer)
  - Playstyle: Support | Shape: triangle | Color: #FF00FF | Icon: /assets/player/data_sorcerer.png
  - Default Weapon: DATA_SIGIL
  - Loadout: DATA_SIGIL, SORCERER_ORB, PLASMA, TRI_SHOT
  - Base Stats: hp 95 | maxHp 95 | speed 8.4 | damage 28 | str 4 | int 10 | agi 7 | luck 9 | def 5
  - Derived: critChance ≈ 12 | survivability ≈ 104 | powerScore ≈ 135
  - Special: Sigilweave — rotating glyph emits pulsing shockwaves
  - Default Weapon L1 damage: Data Sigil seed 28 on plant; pulses 20 each ×2 (radius ≈ 98)

- Ghost Operative (id: ghost_operative)
  - Playstyle: Stealth | Shape: triangle | Color: #708090 | Icon: /assets/player/ghost_operative.png
  - Default Weapon: GHOST_SNIPER
  - Loadout: GHOST_SNIPER, RICOCHET, TRI_SHOT
  - Base Stats: hp 80 | maxHp 80 | speed 9.0 | damage 42 | str 6 | int 8 | agi 10 | luck 9 | def 3
  - Derived: critChance ≈ 13 | survivability ≈ 85 | powerScore ≈ 140
  - Special: Phase Cloak — temporary invisibility and damage immunity
  - Default Weapon L1 damage: Ghost Sniper 95 per shot

- Neural Nomad (id: neural_nomad)
  - Playstyle: Support | Shape: circle | Color: #9370DB | Icon: /assets/player/neural_nomad.png
  - Default Weapon: NOMAD_NEURAL
  - Loadout: NOMAD_NEURAL, PLASMA, SCAVENGER_SLING
  - Base Stats: hp 105 | maxHp 105 | speed 7.6 | damage 26 | str 5 | int 9 | agi 7 | luck 8 | def 6
  - Derived: critChance ≈ 11 | survivability ≈ 118 | powerScore ≈ 129
  - Special: Neural Storm — area effect psychic blast
  - Default Weapon L1 damage: Neural Threader 26 per hit; thread pulses ≈ 60% of base per pulse

- Psionic Weaver (id: psionic_weaver)
  - Playstyle: Balanced | Shape: circle | Color: #FF69B4 | Icon: /assets/player/psionic_weaver.png
  - Default Weapon: PSIONIC_WAVE
  - Loadout: PSIONIC_WAVE, PLASMA, TRI_SHOT
  - Base Stats: hp 115 | maxHp 115 | speed 7.4 | damage 28 | str 6 | int 9 | agi 6 | luck 7 | def 7
  - Derived: critChance ≈ 10 | survivability ≈ 131 | powerScore ≈ 133
  - Special: Energy Weave — homing/piercing synergy on projectiles
  - Default Weapon L1 damage: Psionic Wave ≈ 28 per contact (beam-type sweep)

- Rogue Hacker (id: rogue_hacker)
  - Playstyle: Support | Shape: triangle | Color: #FF4500 | Icon: /assets/player/rogue_hacker.png
  - Default Weapon: HACKER_VIRUS
  - Loadout: HACKER_VIRUS, TRI_SHOT, RICOCHET
  - Base Stats: hp 100 | maxHp 100 | speed 8.2 | damage 25 | str 5 | int 10 | agi 8 | luck 9 | def 5
  - Derived: critChance ≈ 12 | survivability ≈ 110 | powerScore ≈ 132
  - Special: System Hack — disables enemy abilities briefly
  - Default Weapon L1 damage: Hacker Virus 32 per hit (class auto-casts zones; zone effects apply paralysis/DoT)

- Shadow Operative (id: shadow_operative)
  - Playstyle: Aggressive | Shape: triangle | Color: #2F4F4F | Icon: /assets/player/shadow_operative.png
  - Default Weapon: VOID_SNIPER
  - Loadout: VOID_SNIPER, SHADOW_DAGGER, RICOCHET, TRI_SHOT
  - Base Stats: hp 110 | maxHp 110 | speed 8.6 | damage 30 | str 7 | int 8 | agi 9 | luck 6 | def 6
  - Derived: critChance ≈ 11 | survivability ≈ 123 | powerScore ≈ 139
  - Special: Ebon Bleed — crits apply stacking void DoT
  - Default Weapon L1 damage: Void Sniper 95 per shot + 3 DoT ticks (1s interval)

- Titan Mech (id: titan_mech)
  - Playstyle: Defensive | Shape: square | Color: #696969 | Icon: /assets/player/titan_mech.png
  - Default Weapon: MECH_MORTAR
  - Loadout: MECH_MORTAR, GUNNER_MINIGUN, SHOTGUN
  - Base Stats: hp 180 | maxHp 180 | speed 5.0 | damage 34 | str 10 | int 6 | agi 2 | luck 4 | def 11
  - Derived: critChance ≈ 6 | survivability ≈ 219 | powerScore ≈ 145
  - Special: Armor Plating — reduced damage from all sources
  - Default Weapon L1 damage: Mech Mortar 90 impact; explosion radius ≈ 200

WEAPONS

Notes:

- All base fields listed; if getLevelStats exists, explicit per-level outputs are documented.
- DPS-derived formula reference: damage = (DPS × cooldown) ÷ (salvo × 60)

- PISTOL (Desert Eagle)
  - Base: cooldown 70f, salvo 1, spread 0, speed 14, range 660, maxLevel 7, damage 58, knockback 32
  - Traits: Heavy, High Damage, Strong Recoil, Large Caliber | Evolution: -> SHOTGUN (requires passive: Bullet Velocity)
  - getLevelStats(level):
    - Tables: cooldown [70,65,60,52,45,42,38], targetDps [50,85,140,255,400,470,540]
    - Derived: damage = round(targetDps*cd/60), speed = 12+idx, projectileSize = 9+idx, explosionRadius = 110+15*idx, pierce = 1/1/1/2/2/2/3

- SHOTGUN
  - Base: cooldown 95f, salvo 5, spread 0.22, speed 5.2, range 200, maxLevel 10, damage 9, knockback 48
  - Traits: High Damage, Short Range, Tight Spread
  - getLevelStats(level 1..10):
    - cooldown [95,90,85,80,75,70,62,55,52,48]
    - pellets [5,5,6,6,7,8,8,9,9,10]
    - targetDps [60,70,85,105,140,185,240,300,350,400]
    - spread [0.22..0.13], speed [5.2..6.2]
    - damage = round(dps*cd/(pellets*60)) per pellet; salvo = pellets

- TRI_SHOT (Triple Crossbow)
  - Base: cooldown 100f, salvo 3, spread 0.155, speed 9.4, range 620, maxLevel 7, damage 22, knockback 26
  - Traits: Piercing, Triple Volley, Long Range, High Base Damage
  - getLevelStats(level):
    - cooldown [100,92,84,74,64,60,56], salvo [3,3,3,3,4,4,5], spread [0.155..0.12]
    - targetDps [40,65,95,140,200,240,285], speed [9.4..10.8], range [620..800]
    - projectileSize 22 + 1.2*idx, pierce [1,2,3,4,5,5,6]; damage = round(dps*cd/(salvo*60))

- RAPID (Smart Rifle)
  - Base: cooldown 42f, salvo 1, spread 0, speed 3.2, range 1400, maxLevel 7, damage 18
  - Traits: Homing, Boss Focus, High Range, Evolution Ready
  - getLevelStats(level):
    - dpsTargets [25,38,55,75,100,125,150], cooldowns [42,38,34,30,26,24,22], salvo [1,1,1,1,2,2,2]
    - damage = round(dps*cd/(salvo*60)), speed [3.2..4.5], turnRate [0.065..0.13]

- LASER (Laser Blaster)
  - Base: cooldown 70f, salvo 3, spread 0.035, speed 16, range 1100, maxLevel 7, damage 27, knockback 3
  - Traits: Burst, Long Range, High Damage, Burn DoT, Stacking (3x)
  - getLevelStats(level):
    - dpsTargets [70,150,300,500,750,900,1050], cooldowns [70..50], spread [0.035..0.030], speed [16..18.6]
    - per-bolt damage = round(dps*cd/(3*60))

- BEAM (disabled)
  - Base: cooldown 50f, salvo 1, speed 17.5, range 700, maxLevel 7, damage 30, knockback 0.5
  - Traits: Boss Beam, Epic Glow, Animated Core
  - getLevelStats(level): dpsTargets [60..360], cooldowns [50..38], thickness [16..19], length [80..92], damage = round(dps*cd/60)

- RICOCHET
  - Base: cooldown 70f, salvo 1, spread 0.05, speed 7, range 420, maxLevel 7, damage 12, knockback 18
  - Traits: Bounces Between Enemies, Locks On Next Target, Max 3 Bounces, Low Damage
  - getLevelStats(level): damage 12→72 (linear across 7), cooldown 70→56 (~20% faster), bounces = level+2 (3..9)

- HOMING (Kamikaze Drone)
  - Base: cooldown 120f, salvo 1, speed 4.9, range 150, maxLevel 7, damage 40, knockback 12
  - Traits: Homing, Circles Player, Explodes on Contact, Kamikaze
  - getLevelStats(level): damage 40→700 (geometric progression), cooldown 120→108 (~10% faster)

- RAILGUN
  - Base: cooldown 120f, salvo 1, range 900, maxLevel 7, damage 50
  - Traits: Visible Charging Orb, 2s Charge Time, Monster Beam, High Damage, Boss
  - getLevelStats(level): dpsTargets [100..950], cooldowns [120..96], beam length [260..320], thickness [20..25], damage = round(dps*cd/60)

- PLASMA (Plasma Core)
  - Base: cooldown 90f, salvo 1, speed 6.2, range 520, maxLevel 7, damage 38
  - Traits: Charge, Detonate, Ion Field, Scaling
  - getLevelStats(level): damage [38,52,68,86,108,125,142], cooldown [90,84,78,72,66,62,58], fragments [3,3,4,4,5,5,6]
  - Extras: chargeTimeMs 450, overheatThreshold 0.85, heatPerShot 0.25, heatPerFullCharge 0.42, heatDecayPerSec 0.35, ionFieldDamageFrac 0.12 (5 ticks), ionFieldDurationMs 600, overchargedMultiplier 2.2, chargedMultiplier 1.8

- RUNNER_GUN
  - Base: cooldown 12f, salvo 2, spread 0.12, speed 10.5, range 360, maxLevel 7, damage 6, knockback 5
  - Traits: Spray, Fast, Scaling (class weapon)
  - getLevelStats(level): damage ~6→? via dmg=Math.round(6*(1+(level-1)*(7.5-1)/6)), cooldown = round(12*(1-(level-1)*0.32/6))

- WARRIOR_CANNON
  - Base: cooldown 60f, salvo 1, speed 5.6, range 250, maxLevel 7, damage 60
  - Traits: Explosive, Burst, Scaling (class weapon)
  - getLevelStats(level): same formula pattern as RUNNER_GUN with baseDamage=60, baseCooldown=60

- TACHYON_SPEAR
  - Base: cooldown 48f, salvo 1, speed 14, range 680, maxLevel 7, damage 42, knockback 18
  - Traits: Dash Pierce, Warp Trail, Line Killer | Evolution -> SINGULARITY_SPEAR (requires passive Overclock)
  - getLevelStats(level): damage [42,56,74,96,122,152,186], cooldown [48..36], length [100..160], speed [14..20]

- SINGULARITY_SPEAR
  - Base: cooldown 64f, salvo 1, speed 16, range 720, maxLevel 7, damage 66, knockback 22
  - Traits: Dash Pierce, Implode+Explode, Gravity Ring
  - getLevelStats(level): damage [66..264], cooldown [64..52], length [120..180], speed [16..22]

- SORCERER_ORB
  - Base: cooldown 144f, salvo 1, speed 3.2, range 1200, maxLevel 7, damage 144
  - Traits: Piercing, Homing, Returns, Scaling (class weapon)
  - getLevelStats(level): base formula pattern with baseDamage=144, baseCooldown=144

- DATA_SIGIL
  - Base: cooldown 72f, salvo 1, speed 6.0, range 380, maxLevel 7, damage 28, knockback 2
  - Traits: Area, Pulses, Control, Scaling (class weapon)
  - getLevelStats(level): damage [28..106], cooldown [72..48], sigilRadius [98..210], pulseCount [2,2,3,3,4,4,5], pulseDamage [20..200]

- SHADOW_DAGGER
  - Base: cooldown 18f, salvo 1, speed 12.6, range 420, maxLevel 7, damage 18, knockback 20
  - Traits: Ricochet, Critical, Scaling (class weapon)
  - getLevelStats(level): base formula pattern with baseDamage=18, baseCooldown=18

- BIO_TOXIN
  - Base: cooldown 88f, salvo 1, speed 3.5, range 260, maxLevel 7, damage 0
  - Traits: Poison, Area, Scaling (class weapon)
  - getLevelStats(level): cooldown = max(36, round(88*(1-(level-1)*0.40/6))), damage fixed 0 (puddle/poison carry damage)

- HACKER_VIRUS
  - Base: cooldown 32f, salvo 1, speed 8.4, range 340, maxLevel 7, damage 32
  - Traits: EMP, Disrupt, Pierces, Scaling (class weapon)
  - getLevelStats(level): same base pattern as others with baseDamage=32, baseCooldown=32

- GUNNER_MINIGUN
  - Base: cooldown 10f, salvo 1, spread 0.22, speed 7.7, range 320, maxLevel 7, damage 10
  - Traits: Spray, Rapid, Scaling (class weapon)
  - getLevelStats(level): same base pattern with baseDamage=10, baseCooldown=10

- PSIONIC_WAVE
  - Base: cooldown 28f, salvo 1, speed 9.1, range 500, maxLevel 7, damage 28
  - Traits: Pierces, Area, Slow, Scaling (class weapon)
  - getLevelStats(level): same base pattern with added bounces = level

- SCAVENGER_SLING
  - Base: cooldown 38f, salvo 1, speed 7, range 300, maxLevel 7, damage 38, knockback 24
  - Traits: Bounces, Scaling (class weapon)
  - getLevelStats(level): base pattern with baseDamage=38, baseCooldown=38

- NOMAD_NEURAL (Neural Threader)
  - Base: cooldown 64f, salvo 1, speed 11.0, range 720, maxLevel 7, damage 26
  - Traits: Thread, Anchors, Pulses, Pierces, Scaling (class weapon)
  - getLevelStats(level): damage [26,32,40,50,62,76,92], cooldown [64,60,56,52,48,44,40], anchors [2..8], threadLifeMs [3000..5000], pulseIntervalMs [500..380], pulsePct [0.60..1.10]

- GHOST_SNIPER
  - Base: cooldown 95f, salvo 1, speed 22.4, range 1200, maxLevel 7, damage 95
  - Traits: Laser, Armor Pierce, Scaling (class weapon)
  - getLevelStats(level): base pattern with baseDamage=95, baseCooldown=95

- VOID_SNIPER
  - Base: cooldown 95f, salvo 1, speed 22.4, range 1200, maxLevel 7, damage 95
  - Traits: Laser, Paralysis (0.5s), Damage Over Time, Pierces, Scaling (class weapon)
  - getLevelStats(level): base pattern with baseDamage=95, baseCooldown=95; ticks=3, tickIntervalMs=1000

- MECH_MORTAR
  - Base: cooldown 90f, salvo 1, speed 7, range 520, maxLevel 8, damage 90, explosionRadius 200
  - Traits: Heavy, AoE, Scaling (class weapon)
  - getLevelStats(level 1..8): damage via mult=5.8333 across 4 steps, cooldown ~-30%, explosionRadius ~+12%/level

- QUANTUM_HALO
  - Base: cooldown 9999f (unused), orbCount 2+, orbitRadius ~70→, spinSpeed [3.2..5.0], damage 22, knockback 28
  - Traits: Orbit, Persistent, Pulse, Scaling, Defense
  - getLevelStats(level): damage [22,30,42,58,76,95,115], orbCount [2,2,3,3,4,4,5], orbitRadius ≈ round(70*1.10^(lvl-1)), spinSpeed [3.2..5.0], pulseDamage [0,0,0,90,130,170,220]

- SCRAP_SAW
  - Base: cooldownMs 930, range 140, maxLevel 7, damage 32, knockback 60
  - Traits: Melee, Arc Sweep, Scrap Stacks, Scrap Explosion, Self-Heal, Tether, Armor Shred, High Knockback
  - getLevelStats(level):
    - damage [38,55,77,106,142,180,225], cooldownMs [840,810,780,750,720,690,660]
    - arcDegrees [140,180,220,260,300,330,360], sweepDurationMs [280..420]
    - shrapnelCount [6,6,7,8,8,9,10], reachPx [140..200], thicknessPx [22..36]

- INDUSTRIAL_GRINDER
  - Base: cooldown 180f, range 140, maxLevel 7, damage 20, knockback 95
  - Traits: Melee, Sustained Orbit, Strong Knockback
  - getLevelStats(level): cooldown [180..132], damage [20..86], durationMs [1200..1500], orbitRadius [120..150]

PASSIVES

- Speed Boost (id 0, maxLevel 7)
  - Effect: +0.5 move speed per level (additive to base)

- Max HP (id 1, maxLevel 7)
  - Effect: +20 max HP per level up to L5; +15 per level at L6–L7. Heals 55% of gained HP.

- Damage Up (id 2, maxLevel 7)
  - Effect: Global damage multiplier = 1 + level*0.14

- Fire Rate (id 3, maxLevel 7)
  - Effect: fireRateModifier = 1 + level*0.13

- AOE On Kill (id 4, maxLevel 1)
  - Effect: hasAoeOnKill = true (no numeric scaling)

- Magnet (id 5, maxLevel 5)
  - Effect: magnetRadius = 120 + level*36

- Shield (id 6, maxLevel 5)
  - Effect: shieldChance = min(0.5, level*0.055)

- Crit (id 7, maxLevel 7)
  - Effect: critBonus = min(0.55, level*0.0375); critMultiplier = min(3.1, 1.5 + level*0.095)

- Piercing (id 8, maxLevel 3)
  - Effect: piercing level stored as number, adds that many extra enemy passes

- Regen (id 9, maxLevel 7)
  - Effect: regen rate = min(level,5)*0.125 + max(0, level-5)*0.09 HP/sec

- Area Up (id 10, maxLevel 3)
  - Effect: globalAreaMultiplier = 1 + level*0.10 (clamped to 3 levels)

END OF FILE
