# Elite Sprite Generation Prompts

Use these prompts to generate transparent PNG sprites for elite enemies and related projectiles/VFX. Keep top-down readability and no baked outer glow.

## Output locations

- Enemies (64x64): `public/assets/enemies/elite/`
- Projectiles/mines (24–32 px): `public/assets/projectiles/elite/`
- VFX markers (32–64 px): `public/assets/vfx/`

## Global style

Create a TRANSPARENT PNG. Top-down view. Cyberpunk neon, clean silhouette, subtle rim-light, no background, no baked drop shadows or outer glow. Keep a 2–3 px safe margin.

---

### 1) Elite Gunner

- File: `elite_gunner.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down view. Cyberpunk neon style, flat/cel shading with clean silhouette and subtle rim-light. No text, no background, no baked outer glow. Subject: elite gunner drone — compact triangular chassis with cyan/teal neon accents (#00E6D7), small forward muzzle.

- File: `elite_gunner_bolt.png` (24x24)
Prompt: Create a 24x24 PNG, transparent background, top-down projectile sprite. High contrast, readable at small size, neon glow implied by color edges only. Subject: slim cyan bolt with slight core-to-edge gradient, elongated oval.

### 2) Elite Bomber

- File: `elite_bomber.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down view. Subject: elite bomber — bulky beetle-like body with hazard warm yellow-orange accents (#FFA84D), exposed volatile core in the center.

- File: `elite_bomber_core.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Subject: circular volatile core, orange to red inner color implied, cracked surface, top-down.

### 3) Elite Charger

- File: `elite_charger.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite charger — aerodynamic arrowhead body, magenta accents (#FF4DD2), reinforced front spike.

- File: `elite_charger_streak.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Subject: short tapered streak wedge, magenta gradient center, top-down.

### 4) Elite Suppressor

- File: `elite_suppressor.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite suppressor — compact turret head with blue accents (#31A8FF), side vents.

- File: `elite_suppressor_shield.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background. Subject: thin circular energy ring, semi-transparent, blue (#31A8FF), centered.

### 5) Elite Blinker

- File: `elite_blinker.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite blinker — sleek diamond body with violet accents (#9B6CFF), small fins.

- File: `elite_blinker_glyph.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Subject: minimal teleport sigil, 4-point star or rhombus, violet.

### 6) Elite Splicer

- File: `elite_splicer.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite splicer — segmented insectoid body, neon green accents (#57FFB0), visible joint lines.

- File: `elite_splicer_mini.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: smaller variant of splicer (about 75% of original), same green palette, simplified.

### 7) Elite Mine-Layer

- File: `elite_mine_layer.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite mine-layer — spider-like chassis, orange-red highlights, underside mine bay.

- File: `elite_mine.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Subject: circular mine with triangular warning petals, orange-red, top-down.

### 8) Elite Siphon

- File: `elite_siphon.png` (64x64)
Prompt: Create a 64x64 PNG, transparent background, top-down. Subject: elite siphon — orb-centric body with petal-like arms, pink-violet accents, subtle concentric motif.

- File: `elite_siphon_aura.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Subject: faint circular aura sigil, pink-violet, thin double ring.

### Meteor spawn VFX (optional)

- File: `meteor_streak.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Diagonal meteor streak: thin tapered line with warm orange to red color (#FFA84D to #FF4136), subtle motion blur implied.

- File: `ground_telegraph.png` (32x32)
Prompt: Create a 32x32 PNG, transparent background. Small concentric ring marker, orange (#FFA84D), top-down.
