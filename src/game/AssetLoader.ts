export type Manifest = any;

export class AssetLoader {
  private cache: Record<string, HTMLImageElement> = {};
  private manifest: Manifest | null = null;

  public getImage(path: string): HTMLImageElement | undefined {
    return this.cache[path];
  }

  private getName(path: string): string {
    const file = path.split('/').pop() || path;
    return file.split('.')[0];
  }

  private getDimsForPath(path: string): { w: number; h: number } {
    const name = this.getName(path);
    switch (name) {
      case 'player_base': return { w: 64, h: 64 };
      case 'enemy_small': return { w: 48, h: 48 };
      case 'enemy_medium': return { w: 64, h: 64 };
      case 'enemy_large': return { w: 96, h: 96 };
      case 'boss_phase1':
      case 'boss_phase2':
      case 'boss_phase3': return { w: 256, h: 256 };
      case 'bullet_cyan': return { w: 16, h: 16 };
      case 'boss_shot_set': return { w: 24, h: 24 };
      case 'particles_sheet': return { w: 64, h: 64 };
      case 'hp_bar_bg': return { w: 128, h: 16 };
      case 'hp_bar_fill': return { w: 128, h: 16 };
      case 'upgrade_speed':
      case 'upgrade_hp': return { w: 64, h: 64 };
      case 'cyber_runner': return { w: 64, h: 64 }; // Example entry for new character
      case 'psionic_weaver': return { w: 64, h: 64 }; // Ensure psionic_weaver is handled
  case 'bio_engineer': return { w: 64, h: 64 }; // Ensure bio_engineer is handled
  case 'titan_mech': return { w: 64, h: 64 }; // Ensure titan_mech is handled
      case 'tech_warrior_anim': return { w: 64, h: 64 }; // Example entry for new animated character
      case 'character_select_bg': return { w: 1920, h: 1080 }; // Added for character select background
      default: return { w: 64, h: 64 };
    }
  }

  private createPlaceholderImage(width: number, height: number, label: string, assetInfo?: any): HTMLImageElement {
    const canvas = document.createElement('canvas');
    const img = new Image();

    if (label.endsWith('_anim') && assetInfo && assetInfo.frameW && assetInfo.frameH && assetInfo.frames) {
      const frameWidth = assetInfo.frameW;
      const frameHeight = assetInfo.frameH;
      const totalFrames = assetInfo.frames;
      canvas.width = frameWidth * totalFrames; // Width for all frames
      canvas.height = frameHeight;

      const ctx = canvas.getContext('2d')!;
      for (let i = 0; i < totalFrames; i++) {
        const hue = (i / totalFrames) * 360; // Different color for each frame
        ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
        ctx.fillRect(i * frameWidth, 0, frameWidth, frameHeight);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(i * frameWidth, 0, frameWidth, frameHeight);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${label} ${i + 1}`, i * frameWidth + frameWidth / 2, frameHeight / 2);
      }
    } else {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, width - 1, height - 1);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, width / 2, height / 2);
    }

    img.src = canvas.toDataURL();
    return img;
  }

  public async loadManifest(url = '/assets/manifest.json') {
    const resp = await fetch(url);
    this.manifest = await resp.json();
    return this.manifest;
  }

  public async loadImage(path: string) {
    if (this.cache[path]) return this.cache[path];
    const img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error('Image load failed: ' + path));
        img.src = path;
      });
      this.cache[path] = img;
      return img;
    } catch {
      const { w, h } = this.getDimsForPath(path);
      const label = this.getName(path);
      // Get asset info from manifest if available
      const assetInfo = this.getAssetInfo(label); // Use label as key for getAssetInfo
      const placeholder = this.createPlaceholderImage(w, h, label, assetInfo); // Pass assetInfo
      this.cache[path] = placeholder;
      return placeholder;
    }
  }

  public async loadAllFromManifest(base = '/assets') {
    if (!this.manifest) await this.loadManifest(base + '/manifest.json');
    const files: string[] = [];
    const walk = (obj: any) => {
      for (const k in obj) {
        const v = obj[k];
        if (v && v.file) files.push('/' + v.file);
        else if (typeof v === 'object') walk(v);
      }
    };
    walk(this.manifest);
    const promises = files.map((f) => this.loadImage(f));
    await Promise.all(promises);
    return this.manifest;
  }

  public drawFrame(ctx: CanvasRenderingContext2D, path: string, frameX: number, frameY: number, w: number, h: number, dx: number, dy: number) {
    const img = this.cache[path];
    if (!img) return;
    ctx.drawImage(img, frameX, frameY, w, h, dx - w / 2, dy - h / 2, w, h);
  }

  public renderAnimatedSprite(ctx: CanvasRenderingContext2D, path: string, frameIndex: number, dx: number, dy: number, frameW?: number, frameH?: number) {
    const img = this.cache[path];
    if (!img) return;
    const w = frameW ?? 64;
    const h = frameH ?? 64;
    const cols = Math.max(1, Math.floor(img.width / w));
    const col = frameIndex % cols;
    const row = Math.floor(frameIndex / cols);
    this.drawFrame(ctx, path, col * w, row * h, w, h, dx, dy);
  }

  public getAssetInfo(key: string): any | undefined {
    if (!this.manifest) return undefined;

    // Simple recursive search for the key in the manifest
    const search = (obj: any): any | undefined => {
      for (const k in obj) {
        if (k === key) {
          return obj[k];
        }
        if (typeof obj[k] === 'object' && obj[k] !== null) {
          const result = search(obj[k]);
          if (result) return result;
        }
      }
      return undefined;
    };
    return search(this.manifest);
  }

  public renderSpriteFrame(ctx: CanvasRenderingContext2D, path: string, frameX: number, frameY: number, w: number, h: number, dx: number, dy: number) {
    this.drawFrame(ctx, path, frameX, frameY, w, h, dx, dy);
  }
}
