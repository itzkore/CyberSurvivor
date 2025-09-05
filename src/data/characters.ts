import { WeaponType } from "../game/WeaponType";
import { AssetLoader } from "../game/AssetLoader";

export interface CharacterData {
  id: string;
  name: string;
  description: string;
  lore: string;
  icon: string;
  defaultWeapon: WeaponType;
  stats: {
    hp: number;
    maxHp: number;
    speed: number;
    damage: number;
    strength: number;
    intelligence: number;
    agility: number;
    luck: number;
    defense: number;
  /** Derived overall power rating (computed at load, not persisted) */
  powerScore?: number;
  /** Potential crit chance baseline derived from agility + luck */
  critChance?: number;
  /** Effective EHP proxy (hp * (1 + defense/50)) */
  survivability?: number;
  /** Offense proxy: damage scaled by STR+INT (display-only) */
  damageIndex?: number;
  /** Mobility proxy: speed scaled by AGI (display-only) */
  movementIndex?: number;
  };
  shape: 'circle' | 'square' | 'triangle';
  color: string;
  weaponTypes: WeaponType[];
  specialAbility?: string;
  playstyle: 'Aggressive' | 'Defensive' | 'Balanced' | 'Support' | 'Stealth' | 'Mobility';
}

export const CHARACTERS: CharacterData[] = [
  {
    id: 'wasteland_scavenger',
    name: 'Wasteland Scavenger',
  description: 'Turns ruin into salvation. Tethers a Scrap‑Saw and detonates scrap surges to endure.',
  lore: 'They were raised where the wind howls through hollowed towers and the ground cuts like glass. A length of cable, a motor, a blade—call it a weapon, call it a promise. The Scrap‑Saw hums like a heartbeat, tethered to a survivor who refuses to break. When the world closes in, they kindle a blast from the very wreckage underfoot and patch their wounds with the memory of those who didn’t make it. Nothing is wasted—not steel, not pain, not hope.',
  icon: AssetLoader.normalizePath('/assets/player/wasteland_scavenger.png'),
  defaultWeapon: WeaponType.SCRAP_LASH,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 8.0,
      damage: 23,
      strength: 6,
      intelligence: 6,
      agility: 7,
      luck: 8,
      defense: 5,
    },
    shape: 'square',
    color: '#808080',
    weaponTypes: [WeaponType.RICOCHET, WeaponType.SHOTGUN],
  specialAbility: 'Scrap Surge — Build scrap, unleash a protective blast, and self‑repair +5 HP',
    playstyle: 'Balanced',
  },
  {
    id: 'tech_warrior',
    name: 'Tech Warrior',
  description: 'Spearheads battles with tachyon lances and collapses threats with singularity tech.',
  lore: 'The last prototype to walk out of a black‑site lab, wired with reflex lattices that taste the future half a second early. Tachyon spears stitch the air with blue fire; singularities blossom like iron flowers. They fight with a scientist’s precision and a soldier’s heart—measured, decisive, unstoppable.',
  icon: AssetLoader.normalizePath('/assets/player/tech_warrior.png'),
  defaultWeapon: WeaponType.TACHYON_SPEAR,
    stats: {
      hp: 125,
      maxHp: 125,
      speed: 7.2,
      damage: 25,
      strength: 8,
      intelligence: 8,
      agility: 6,
      luck: 6,
      defense: 8,
    },
    shape: 'square',
    color: '#4169E1',
  weaponTypes: [WeaponType.TRI_SHOT, WeaponType.PLASMA, WeaponType.TACHYON_SPEAR, WeaponType.SINGULARITY_SPEAR],
    specialAbility: 'Tech Sync - Faster reload and firing rates with advanced weapons',
    playstyle: 'Aggressive',
  },
  {
    id: 'heavy_gunner',
    name: 'Heavy Gunner',
  description: 'A moving bastion who drowns the field in suppressive storms of lead.',
  lore: 'They were the last to retreat and the first to return. Carbon wrists, tungsten spine, barrels etched with the names they couldn’t save. When the minigun spins up, the world slows under the weight of it—every step a shield for those behind, every burst a promise that nobody else falls today.',
  icon: AssetLoader.normalizePath('/assets/player/heavy_gunner.png'),
    defaultWeapon: WeaponType.GUNNER_MINIGUN,
    stats: {
      hp: 150,
      maxHp: 150,
      speed: 5.6,
      damage: 27,
      strength: 9,
      intelligence: 4,
      agility: 3,
      luck: 5,
      defense: 9,
    },
    shape: 'square',
    color: '#8B4513',
    weaponTypes: [WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN, WeaponType.MECH_MORTAR],
  specialAbility: 'Suppression Matrix — Sustained fire that slows enemy movement',
    playstyle: 'Aggressive',
  },
  {
    id: 'cyber_runner',
    name: 'Cyber Runner',
  description: 'Velocity addict—blinks along vectors, leaves afterimages, and never stops moving.',
  lore: 'They grew up on rooftop freeways and forgotten rail lines, racing the sun across broken glass. Neuromods wind the world into clean lines; their dash bites the horizon and returns them whole—briefly untouchable, joy carved into motion. They run toward the life they deserve, and the city learns to keep up.',
  icon: AssetLoader.normalizePath('/assets/player/cyber_runner.png'),
  defaultWeapon: WeaponType.RUNNER_GUN,
    stats: {
      hp: 90,
      maxHp: 90,
      speed: 9.8,
      damage: 21,
      strength: 5,
      intelligence: 7,
      agility: 11,
      luck: 8,
      defense: 4,
    },
    shape: 'triangle',
    color: '#00FFFF',
  weaponTypes: [WeaponType.RUNNER_GUN, WeaponType.RICOCHET, WeaponType.PLASMA],
  specialAbility: 'Vector Dash — Level‑scaled dash with brief i‑frames and afterimages',
    playstyle: 'Mobility',
  },
  {
    id: 'bio_engineer',
    name: 'Bio Engineer',
  description: 'Cultivates living weapons and cures in equal measure—neon gardens of survival.',
  lore: 'Once a badge and a lab coat and a keycard to the future. Then came the quiet orders and the broken streets. They walked out with seed cultures hidden in their sleeves and a vow stitched into their hands: no more monsters. Toxins bloom like constellations, remedies root where blood falls. They fight to heal the world that hurt them.',
  icon: AssetLoader.normalizePath('/assets/player/bio_engineer.png'),
  defaultWeapon: WeaponType.BIO_TOXIN,
    stats: {
      hp: 110,
      maxHp: 110,
      speed: 6.9,
      damage: 24,
      strength: 5,
      intelligence: 10,
      agility: 6,
      luck: 6,
      defense: 6,
    },
    shape: 'circle',
    color: '#39FF14',
  weaponTypes: [WeaponType.BIO_TOXIN, WeaponType.PLASMA, WeaponType.SHOTGUN],
    specialAbility: 'Bio Hazard - Weapons apply damage over time effects',
    playstyle: 'Support',
  },
  {
    id: 'data_sorcerer',
    name: 'Data Sorcerer',
  description: 'Writes sigils in the air and reality obeys—code becomes prayer, power, and precision.',
  lore: 'They hear the city like a choir: fan hums, fiber whispers, hearts in syncopation. Once they wrote code to move markets; now they draw glyphs that retask fate. Orbs orbit like patient moons, beams etch corrections into the night. When they finish a cast, the world is a little more kind.',
  icon: AssetLoader.normalizePath('/assets/player/data_sorcerer.png'),
  defaultWeapon: WeaponType.GLYPH_COMPILER,
    stats: {
      hp: 95,
      maxHp: 95,
      speed: 8.4,
      damage: 28,
      strength: 4,
      intelligence: 10,
      agility: 7,
      luck: 9,
      defense: 5,
    },
    shape: 'triangle',
  color: '#FFD700',
  weaponTypes: [WeaponType.GLYPH_COMPILER, WeaponType.DATA_SIGIL, WeaponType.SORCERER_ORB, WeaponType.PLASMA, WeaponType.TRI_SHOT],
  specialAbility: 'Sigilweave — Place a rotating glyph that emits pulsing shockwaves; excels at crowd control',
    playstyle: 'Support',
  },
  {
    id: 'ghost_operative',
    name: 'Ghost Operative',
  description: 'A rifle and a rumor—seen only in the last frame before the world goes quiet.',
  lore: 'There is no file—only a negative space where a life should be. Phase cloak washes the edges off every bullet, every breath. Mercy is a pinned butterfly in a glass case; necessity is the trigger. They paint the night with one perfect line and leave the city a degree safer.',
  icon: AssetLoader.normalizePath('/assets/player/ghost_operative.png'),
  defaultWeapon: WeaponType.GHOST_SNIPER,
    stats: {
      hp: 80,
      maxHp: 80,
      speed: 9.0,
      damage: 42, // Increased base operative damage for one-shot synergy
      strength: 6,
      intelligence: 8,
      agility: 10, // Slight agility bump for crit scaling
      luck: 9, // Higher luck improves critChance formula
      defense: 3,
    },
    shape: 'triangle',
  color: '#6B1FB3',
  weaponTypes: [WeaponType.GHOST_SNIPER, WeaponType.RICOCHET, WeaponType.TRI_SHOT],
    specialAbility: 'Phase Cloak - Temporary invisibility and damage immunity',
    playstyle: 'Stealth',
  },
  {
    id: 'neural_nomad',
    name: 'Neural Nomad',
  description: 'A wanderer of mindscapes who calls storms down upon crowds and leaves gentleness behind.',
  lore: 'The neural wastes taught them to listen—to static, to silence, to the way fear folds. A braid of copper at the base of the skull opened every door. They speak softly and carry weather: a pressure drop, a sudden rain of thought. After the thunder, they stay to build shelter.',
  icon: AssetLoader.normalizePath('/assets/player/neural_nomad.png'),
  defaultWeapon: WeaponType.NOMAD_NEURAL,
    stats: {
      hp: 105,
      maxHp: 105,
      speed: 7.6,
      damage: 26,
      strength: 5,
      intelligence: 9,
      agility: 7,
      luck: 8,
      defense: 6,
    },
    shape: 'circle',
    color: '#9370DB',
  weaponTypes: [WeaponType.NOMAD_NEURAL, WeaponType.PLASMA],
    specialAbility: 'Neural Storm - Area effect psychic blast',
    playstyle: 'Support',
  },
  {
    id: 'psionic_weaver',
    name: 'Psionic Weaver',
  description: 'Braids radiant patterns that pierce, protect, and make a battlefield beautiful.',
  lore: 'Their first loom was a cracked screen and a mind that wouldn’t sit still. Years later, the threads are rivers of light pulled through calibrated steel. They stitch wards into the air and lace enemies with mercy’s sharp edge. Even in catastrophe, their handiwork glows with grace.',
  icon: AssetLoader.normalizePath('/assets/player/psionic_weaver.png'),
  defaultWeapon: WeaponType.PSIONIC_WAVE,
    stats: {
      hp: 115,
      maxHp: 115,
      speed: 7.4,
      damage: 28,
      strength: 6,
      intelligence: 9,
      agility: 6,
      luck: 7,
      defense: 7,
    },
    shape: 'circle',
    color: '#FF69B4',
  weaponTypes: [WeaponType.PSIONIC_WAVE, WeaponType.PLASMA, WeaponType.TRI_SHOT],
    specialAbility: 'Energy Weave - Projectiles gain homing and piercing effects',
    playstyle: 'Balanced',
  },
  {
    id: 'rogue_hacker',
    name: 'Rogue Hacker',
  description: 'Smiles, types, and systems fall quiet—viruses that fight for the voiceless.',
  lore: 'They saw the truth in a redacted line and chose exile over obedience. Their tools are unlawful elegance: heat‑slick keys, glitched ghosts, doors that open where walls used to be. For every theft the corps committed, a virus sings justice back into the street.',
  icon: AssetLoader.normalizePath('/assets/player/rogue_hacker.png'),
  defaultWeapon: WeaponType.HACKER_VIRUS,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 8.2,
      damage: 25,
      strength: 5,
      intelligence: 10,
      agility: 8,
      luck: 9,
      defense: 5,
    },
    shape: 'triangle',
    color: '#FF4500',
  weaponTypes: [WeaponType.HACKER_VIRUS, WeaponType.TRI_SHOT, WeaponType.RICOCHET],
    specialAbility: 'System Hack - Weapons temporarily disable enemy abilities',
    playstyle: 'Support',
  },
  {
    id: 'shadow_operative',
    name: 'Shadow Operative',
  description: 'Lethality distilled—wounds that keep bleeding, void that bites twice.',
  lore: 'They were sharpened in wars that never had names. The void took to them like ink to a blade, leaving scars the color of distant galaxies. Enemies don’t just fall; they fade, their life devoured in stacking echoes of pain. They made an oath to end wars before they begin—and to disappear when the job is done.',
  icon: AssetLoader.normalizePath('/assets/player/shadow_operative.png'),
  defaultWeapon: WeaponType.VOID_SNIPER,
    stats: {
      hp: 110,
      maxHp: 110,
      speed: 8.6,
      damage: 30,
      strength: 7,
      intelligence: 8,
      agility: 9,
      luck: 6,
      defense: 6,
    },
    shape: 'triangle',
    color: '#2F4F4F',
  weaponTypes: [WeaponType.VOID_SNIPER, WeaponType.RICOCHET, WeaponType.TRI_SHOT],
  specialAbility: 'Ebon Bleed — Critical hits apply stacking void DoT with vicious effects',
    playstyle: 'Aggressive',
  },
  {
    id: 'titan_mech',
    name: 'Titan Mech',
  description: 'A cathedral of steel with a human heart—thunder walks where they go.',
  lore: 'They traded bones for plate and breath for hydraulics—and kept the part that mattered. Birds land on the antennae when the guns are cool. When the mortar speaks, it is a promise of safety and a warning to the cruel. They stand between the fragile and the fire and call it love.',
  icon: AssetLoader.normalizePath('/assets/player/titan_mech.png'),
    defaultWeapon: WeaponType.MECH_MORTAR,
    stats: {
      hp: 180,
      maxHp: 180,
      speed: 5.0,
      damage: 34,
      strength: 10,
      intelligence: 6,
      agility: 2,
      luck: 4,
      defense: 11,
    },
    shape: 'square',
    color: '#696969',
    weaponTypes: [WeaponType.MECH_MORTAR, WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN],
    specialAbility: 'Armor Plating - Reduced damage from all sources',
    playstyle: 'Defensive',
  },
];

// Normalize icon paths for file:// protocol so leading '/assets/' becomes './assets/'
if (typeof location !== 'undefined' && location.protocol === 'file:') {
  for (const c of CHARACTERS) {
    if (c.icon.startsWith('/assets/')) {
      c.icon = '.' + c.icon; // '/assets/x.png' -> './assets/x.png'
    }
  }
}

// Post-process derived stats for balance transparency
for (const c of CHARACTERS) {
  const s = c.stats;
  // Survivability: hp * (1 + defense/50)
  s.survivability = Math.round(s.hp * (1 + s.defense / 50));
  // Crit chance baseline: (agility * 0.8 + luck * 1.2) / 2 (% -> clamp)
  const crit = (s.agility * 0.8 + s.luck * 1.2) * 0.5;
  s.critChance = Math.min(60, Math.round(crit));
  // Power score: weighted blend of offensive + utility
  s.powerScore = Math.round(
    s.damage * 1.8 +
    s.strength * 1.2 +
    s.intelligence * 1.4 +
    s.agility * 1.1 +
    s.luck * 0.9 +
    s.defense * 0.8 +
    (s.speed * 3) // speed has high influence on overall power
  );
  // Damage index: quick offensive proxy similar to survivability (display only)
  // Emphasize weapon damage with contributions from STR and INT.
  // Formula: round(damage * (1 + (strength*0.6 + intelligence*0.8)/50))
  s.damageIndex = Math.round(s.damage * (1 + ((s.strength * 0.6 + s.intelligence * 0.8) / 50)));
  // Movement index: mobility proxy combining base speed and agility.
  // Formula: round(speed * (1 + agility/20))
  s.movementIndex = Math.round(s.speed * (1 + s.agility / 20));
}
