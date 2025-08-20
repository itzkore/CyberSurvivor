# 🎮 Cyberpunk Neon Asset Pack

Professional 2D game assets for cyberpunk-themed Canvas games, optimized for top-down/twin-stick shooters and Vampire Survivors-style games.

## 📦 Package Contents

### Assets Included
- **Enemies**: 3 types (small 48x48, medium 64x64, large 96x96)
- **Player**: Cyberpunk character (64x64) 
- **Boss**: 3 phases (256x256 each)
- **Projectiles**: Player bullets + animated boss shots
- **Particles**: Explosion, spark, and smoke effects
- **UI Elements**: Health bars, upgrade icons

### Technical Specifications
- **Format**: PNG with transparency (RGBA)
- **Style**: Neon cyberpunk with strong outer glow
- **Optimization**: Web-optimized file sizes
- **Resolution**: 96 DPI, anti-aliased
- **Color Palette**: Cyan (#00FFD1), Magenta (#FF00E6), Yellow (#FFD300)

## 🚀 Quick Start

### 1. Installation
```bash
# Extract the asset pack to your project
unzip cyberpunk-assets.zip -d public/
```

### 2. Load Assets in Your Game
```javascript
// Import the asset loader
import { CyberpunkAssetLoader } from './asset-loader-example.js';

// Initialize and load
const assets = new CyberpunkAssetLoader();
await assets.preloadAssets();

// Use in your game
const playerImage = assets.getImage('player');
ctx.drawImage(playerImage, x, y);
```

### 3. Animate Sprites
```javascript
// Render animated boss projectiles

// Access animation metadata
console.log(bossShot.animation.fps); // 12 FPS
```

## 📁 Directory Structure

```
assets/
├── manifest.json           # Asset metadata & configuration
├── enemies/
│   └── enemy_default.png   # 64x64, current unified enemy sprite
├── player/
│   └── player_base.png     # 64x64, cyan glow
├── boss/
│   ├── boss_phase1.png     # 256x256, magenta ring
│   └── (future phases removed for now)
├── projectiles/
│   ├── bullet_cyan.png     # 16x16, cyan core
│   └── (boss projectile set deferred)
├── particles/
│   └── particles_sheet.png # 8x8 grid, 8px tiles
└── ui/
    ├── hp_bar_bg.png       # 128x16, background
    ├── hp_bar_fill.png     # 128x16, fill overlay
    └── icons/
        ├── upgrade_speed.png    # 64x64, yellow
        ├── upgrade_damage.png   # 64x64, magenta  
        └── upgrade_health.png   # 64x64, cyan
```

## 🎨 Design Guidelines

### Color Usage
- **Cyan (#00FFD1)**: Player elements, health, friendly UI
- **Magenta (#FF00E6)**: Enemies, damage, warning states
- **Yellow (#FFD300)**: Upgrades, bonuses, special effects
- **Dark BG (#0b0b0b)**: Background, UI panels
- **White (#ffffff)**: Text, accents, highlights

### Glow Effects
All assets feature strong outer glow effects:
- **Player**: Cyan glow with 8px radius
- **Enemies**: Magenta glow with varying intensity
- **Boss**: Progressive glow changes per phase
- **UI**: Subtle glow for visibility and style

### Scaling Recommendations
- **1x Scale**: Original pixel-perfect rendering
- **2x Scale**: Recommended for HD displays
- **0.5x Scale**: Mobile/performance optimization
- **Custom**: Maintain aspect ratios

## 🔧 Technical Integration

### Canvas 2D Context
```javascript
// Basic enemy rendering
const enemy = assets.getImage('enemy_default');
const metadata = assets.getMetadata('enemies', 'small');

ctx.drawImage(
    enemy, 
    x - metadata.w/2, 
    y - metadata.h/2
);

// Collision detection using hitbox radius
const distance = Math.sqrt((x1-x2)**2 + (y1-y2)**2);
if (distance < metadata.hitbox_radius) {
    // Collision detected
}
```

### Sprite Sheet Animation
```javascript
// Boss projectile animation
const frameIndex = Math.floor(time / (1000/12)) % 6; // 12 FPS

```

### UI Health Bar
```javascript
// Render health bar with current health percentage
const bg = assets.getImage('hp_bar_bg');
const fill = assets.getImage('hp_bar_fill');

ctx.drawImage(bg, 10, 10);

// Mask the fill based on current health
const healthPercent = currentHealth / maxHealth;
ctx.drawImage(
    fill,
    0, 0, fill.width * healthPercent, fill.height,
    10, 10, fill.width * healthPercent, fill.height
);
```

## 🎮 Game Engine Support

### Vanilla JavaScript/Canvas
✅ **Primary target** - Fully supported with included loader

### Game Frameworks
✅ **Phaser 3** - Load as image assets  
✅ **PixiJS** - Import as textures  
✅ **Three.js** - Use as materials/textures  
✅ **Babylon.js** - Import as sprite managers  

### Build Tools
✅ **Webpack** - Copy assets to dist folder  
✅ **Vite** - Place in public directory  
✅ **Parcel** - Auto-copy from assets folder  

## 📊 Performance Tips

### Loading Optimization
```javascript
// Preload critical assets first
await assets.loadManifest();
await Promise.all([
    assets.loadImage('player', manifest.player.base.file),
    assets.loadImage('enemy_default', manifest.enemies.default.file)
]);

// Load remaining assets during gameplay
setTimeout(() => assets.preloadAssets(), 1000);
```

### Rendering Optimization
```javascript
// Use object pooling for particles
const particlePool = [];
const maxParticles = 100;

// Cache frequently used images
const cachedPlayer = assets.getImage('player');
const cachedBullet = assets.getImage('bullet_cyan');

// Batch similar draw calls
enemies.forEach(enemy => {
    ctx.drawImage(cachedEnemy, enemy.x, enemy.y);
});
```

## 🎯 Usage Examples

### Vampire Survivors Style
- Use auto-targeting for all weapons
- Spawn enemies from manifest.enemies data
- Implement XP pickups with particle effects
- Boss telegraphs using boss phase variations

### Twin-Stick Shooter  
- Manual aiming with mouse/gamepad
- Rapid bullet spawning from bullet assets
- Screen-space UI overlay
- Particle explosions on impact

### Mobile Touch Game
- Scale UI elements for finger interaction
- Larger hitboxes using metadata.hitbox_radius
- Battery-optimized particle counts
- Touch-friendly upgrade icons

## 📄 License

**Royalty-Free Commercial License** - Use in any commercial or personal project. See `LICENSE.txt` for full terms.

## 🆘 Support

### Common Issues
- **Assets not loading**: Check file paths and manifest.json
- **Blurry rendering**: Disable image smoothing for pixel-perfect
- **Performance issues**: Reduce particle count, use object pooling
- **Mobile compatibility**: Test on actual devices, not just simulators

### Customization
- **Recoloring**: Edit PNG files in image editor
- **New animations**: Add frames to sprite sheets
- **Different sizes**: Scale maintaining glow proportions
- **Additional effects**: Layer multiple particle types

---

**🚀 Ready to create amazing cyberpunk games! Happy coding!**