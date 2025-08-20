// CYBERPUNK ASSET LOADER - Example Implementation
// Usage instructions for the Cyberpunk Neon Asset Pack

class CyberpunkAssetLoader {
    constructor() {
        this.manifest = null;
        this.loadedImages = new Map();
        this.loadedSprites = new Map();
    }

    // 1. Load the manifest first
    async loadManifest() {
        try {
            const response = await fetch('/assets/manifest.json');
            this.manifest = await response.json();
            console.log('Cyberpunk Asset Pack loaded:', this.manifest.name);
            return this.manifest;
        } catch (error) {
            console.error('Failed to load asset manifest:', error);
        }
    }

    // 2. Preload all critical images
    async preloadAssets() {
        if (!this.manifest) {
            await this.loadManifest();
        }

        const imagePromises = [];
        
        // Load player assets
        imagePromises.push(this.loadImage('player', this.manifest.player.base.file));
        
        // Load enemy assets
        Object.entries(this.manifest.enemies).forEach(([key, enemy]) => {
            imagePromises.push(this.loadImage(`enemy_${key}`, enemy.file));
        });
        
        // Load boss assets
        Object.entries(this.manifest.boss).forEach(([key, boss]) => {
            imagePromises.push(this.loadImage(`boss_${key}`, boss.file));
        });
        
        // Load projectiles
        imagePromises.push(this.loadImage('bullet_cyan', this.manifest.projectiles.bullet_cyan.file));
        
        // Load sprite sheets
        Object.entries(this.manifest.spritesheets).forEach(([key, sheet]) => {
            imagePromises.push(this.loadSpriteSheet(key, sheet));
        });
        
        // Load UI elements
        imagePromises.push(this.loadImage('hp_bar_bg', this.manifest.ui.hp_bar_bg.file));
        imagePromises.push(this.loadImage('hp_bar_fill', this.manifest.ui.hp_bar_fill.file));
        
        Object.entries(this.manifest.ui.icons).forEach(([key, icon]) => {
            imagePromises.push(this.loadImage(`icon_${key}`, icon.file));
        });

        await Promise.all(imagePromises);
        console.log('All cyberpunk assets loaded successfully!');
    }

    // 3. Load individual image
    async loadImage(key, path) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.loadedImages.set(key, img);
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
    }

    // 4. Load sprite sheet with animation data
    async loadSpriteSheet(key, sheetData) {
        const img = await this.loadImage(`sheet_${key}`, sheetData.file);
        
        const spriteData = {
            image: img,
            frameWidth: sheetData.frameW,
            frameHeight: sheetData.frameH,
            frames: sheetData.frames,
            animation: sheetData.animation || null
        };
        
        this.loadedSprites.set(key, spriteData);
        return spriteData;
    }

    // 5. Get loaded image
    getImage(key) {
        return this.loadedImages.get(key);
    }

    // 6. Get sprite sheet data
    getSprite(key) {
        return this.loadedSprites.get(key);
    }

    // 7. Render sprite frame
    renderSpriteFrame(ctx, spriteKey, frameIndex, x, y, scale = 1) {
        const sprite = this.getSprite(spriteKey);
        if (!sprite) return;

        const { image, frameWidth, frameHeight } = sprite;
        const sourceX = (frameIndex % sprite.frames) * frameWidth;
        const sourceY = 0; // assuming horizontal arrangement

        ctx.drawImage(
            image,
            sourceX, sourceY, frameWidth, frameHeight,
            x - (frameWidth * scale) / 2, 
            y - (frameHeight * scale) / 2,
            frameWidth * scale, 
            frameHeight * scale
        );
    }

    // 8. Render animated sprite
    renderAnimatedSprite(ctx, spriteKey, animationTime, x, y, scale = 1) {
        const sprite = this.getSprite(spriteKey);
        if (!sprite || !sprite.animation) return;

        const { fps, loop } = sprite.animation;
        const totalFrames = sprite.frames;
        const frameTime = 1000 / fps; // ms per frame
        
        let frameIndex = Math.floor(animationTime / frameTime);
        
        if (loop) {
            frameIndex = frameIndex % totalFrames;
        } else {
            frameIndex = Math.min(frameIndex, totalFrames - 1);
        }

        this.renderSpriteFrame(ctx, spriteKey, frameIndex, x, y, scale);
    }

    // 9. Get asset metadata
    getMetadata(category, key) {
        if (!this.manifest) return null;
        return this.manifest[category]?.[key];
    }

    // 10. Get color palette
    getColors() {
        return this.manifest?.palette || {};
    }
}

// USAGE EXAMPLE in your game:

// Initialize the loader
const assetLoader = new CyberpunkAssetLoader();

// Setup game after assets load
async function initGame() {
    await assetLoader.preloadAssets();
    
    // Now you can use the assets
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    
    // Get color palette
    const colors = assetLoader.getColors();
    
    function gameLoop(timestamp) {
        // Clear canvas with cyberpunk background
        ctx.fillStyle = colors.dark_bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw player
        const playerImg = assetLoader.getImage('player');
        if (playerImg) {
            ctx.drawImage(playerImg, 100, 100);
        }
        
        // Draw enemies
    const smallEnemyImg = assetLoader.getImage('enemy_default');
        if (smallEnemyImg) {
            ctx.drawImage(smallEnemyImg, 200, 150);
        }
        
        // Draw animated boss projectiles
        
        // Draw UI elements
        const hpBarBg = assetLoader.getImage('hp_bar_bg');
        const hpBarFill = assetLoader.getImage('hp_bar_fill');
        if (hpBarBg && hpBarFill) {
            ctx.drawImage(hpBarBg, 10, 10);
            // Draw partial health fill
            const healthPercent = 0.7; // 70% health
            ctx.drawImage(
                hpBarFill, 
                0, 0, hpBarFill.width * healthPercent, hpBarFill.height,
                10, 10, hpBarFill.width * healthPercent, hpBarFill.height
            );
        }
        
        requestAnimationFrame(gameLoop);
    }
    
    // Start the game loop
    gameLoop(0);
}

// DIRECTORY STRUCTURE SETUP:
/*
your-game/
├── public/
│   ├── assets/
│   │   ├── manifest.json
│   │   ├── enemies/
│   │   │   └── enemy_default.png
│   │   ├── player/
│   │   │   └── player_base.png
│   │   ├── boss/
│   │   │   ├── boss_phase1.png
│   │   │   └── (future phases removed)
│   │   ├── projectiles/
│   │   │   ├── bullet_cyan.png
│   │   │   └── (boss projectile set deferred)
│   │   ├── particles/
│   │   │   └── particles_sheet.png
│   │   └── ui/
│   │       ├── hp_bar_bg.png
│   │       ├── hp_bar_fill.png
│   │       └── icons/
│   │           ├── upgrade_speed.png
│   │           ├── upgrade_damage.png
│   │           └── upgrade_health.png
│   └── index.html
├── LICENSE.txt
└── README.md
*/

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initGame);