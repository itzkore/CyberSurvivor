import { Logger } from '../core/Logger';

export type Manifest = any;

export class AssetLoader {
  private cache: Record<string, HTMLImageElement> = {};
  private manifest: Manifest | null = null;
  // NOTE: Manifest pruned to only include existing enemy_default + boss_phase1 assets.
  // If future phases/enemy sizes are restored, re-add expected names here and in manifest.json.
  /**
   * Base prefix for hosted deployment (e.g. /cs when site is https://domain.tld/cs/).
   * "" when served from root over http(s). "./" (represented as '.') when using file: protocol.
   * Heuristic: take first pathname segment if present and not index.html. This supports
   * hosting behind a single folder *without* needing to hardcode it in code.
   */
  public static basePrefix: string = (() => {
    if (typeof location === 'undefined') return '';
    if (location.protocol === 'file:') return '.'; // relative root
    // Meta override (authoritative if present)
    const meta = document.querySelector('meta[name="asset-base"]') as HTMLMetaElement | null;
    if (meta?.content) return meta.content.replace(/\/$/, '');
    // HTML <base href> if present (fallback)
    try {
      const baseEl = document.querySelector('base[href]') as HTMLBaseElement | null;
      if (baseEl && baseEl.href) {
        const u = new URL(baseEl.href);
        let p = (u.pathname || '');
        // Strip trailing "/index.html" if present
        p = p.replace(/\/index\.html?$/i, '');
        return p.replace(/\/$/, '');
      }
    } catch {}
    // Derive from pathname segments (allow multi-segment, e.g., /games/cs)
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      // If last part is an .html file, drop it
      const last = parts[parts.length - 1];
      const segs = /\.html?$/.test(last) ? parts.slice(0, -1) : parts;
      if (segs.length > 0) return '/' + segs.join('/');
    }
    return '';
  })();

  public getImage(path: string): HTMLImageElement | undefined {
  // Normalize to ensure consistent cache key regardless of base prefix or leading slash variations
  const key = AssetLoader.normalizePath(path);
  return this.cache[key];
  }

  private getName(path: string): string {
    const file = path.split('/').pop() || path;
    return file.split('.')[0];
  }

  private getDimsForPath(path: string): { w: number; h: number } {
    const name = this.getName(path);
    switch (name) {
  case 'enemy_default': return { w: 64, h: 64 }; // unified enemy placeholder
  case 'boss_phase1': return { w: 256, h: 256 }; // only phase currently shipped
      case 'bullet_cyan': return { w: 16, h: 16 };
  case 'bullet_deagle': return { w: 16, h: 16 };
  case 'bullet_shotgun': return { w: 16, h: 16 };
  case 'bullet_crossbow': return { w: 16, h: 16 }; // crossbow bolt sprite
  case 'bullet_smart': return { w: 16, h: 16 }; // smart rifle dart sprite
  case 'bullet_laserblaster': return { w: 16, h: 16 }; // laser blaster bolt sprite
  case 'bullet_drone': return { w: 48, h: 48 }; // kamikaze drone sprite
  case 'bullet_saw':
  case 'bullet_sawblade': return { w: 32, h: 32 }; // scrap-saw blade
  case 'bullet_grinder': return { w: 40, h: 40 }; // grinder head
      case 'particles_sheet': return { w: 64, h: 64 };
      case 'hp_bar_bg': return { w: 128, h: 16 };
      case 'hp_bar_fill': return { w: 128, h: 16 };
      case 'upgrade_speed':
      case 'upgrade_hp': return { w: 64, h: 64 };
      case 'cyber_runner': return { w: 64, h: 64 }; // Example entry for new character
      case 'psionic_weaver': return { w: 64, h: 64 }; // Ensure psionic_weaver is handled
  case 'bio_engineer': return { w: 64, h: 64 }; // Ensure bio_engineer is handled
  case 'titan_mech': return { w: 64, h: 64 }; // Ensure titan_mech is handled
  case 'ghost_operative': return { w: 64, h: 64 }; // Ensure ghost_operative is handled
  case 'data_sorcerer': return { w: 64, h: 64 }; // Ensure data_sorcerer is handled
  case 'neural_nomad': return { w: 64, h: 64 }; // Ensure neural_nomad is handled
  case 'shadow_operative': return { w: 64, h: 64 }; // Ensure shadow_operative is handled
  case 'tech_warrior': return { w: 64, h: 64 }; // Ensure tech_warrior is handled
  case 'heavy_gunner': return { w: 64, h: 64 }; // Ensure heavy_gunner is handled
  case 'wasteland_scavenger': return { w: 64, h: 64 }; // Ensure wasteland_scavenger is handled
  case 'rogue_hacker': return { w: 64, h: 64 }; // Ensure rogue_hacker is handled
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

  public async loadManifest(url?: string) {
    const tried: string[] = [];
    const attempts: string[] = [];
    if (url) attempts.push(url);
    else {
      if (location.protocol === 'file:') attempts.push('./assets/manifest.json');
      else {
        // Primary attempt using detected basePrefix ('' or '/cs')
        attempts.push(AssetLoader.basePrefix + '/assets/manifest.json');
  // If basePrefix empty, enqueue known fallback subfolder
  if (!AssetLoader.basePrefix) attempts.push('/cybersurvivor/assets/manifest.json');
      }
    }
    for (const attempt of attempts) {
      if (tried.includes(attempt)) continue;
      tried.push(attempt);
      try {
        const resp = await fetch(attempt);
        if (!resp.ok) throw new Error('Manifest HTTP ' + resp.status);
        const text = await resp.text();
        try {
          this.manifest = JSON.parse(text);
          // Successful fetch: adjust basePrefix if we used a fallback like /cs
          const m = attempt.match(/^(.*)\/assets\/manifest\.json$/);
          if (m && location.protocol !== 'file:') {
            const prefix = m[1];
            // Avoid setting '.' (file) or '' incorrectly
            if (prefix !== '' && prefix !== '.' && prefix !== AssetLoader.basePrefix) {
              AssetLoader.basePrefix = prefix; // future normalizePath calls include discovered prefix
              Logger.info('[AssetLoader] Using discovered asset base prefix ' + AssetLoader.basePrefix);
            }
          }
          return this.manifest;
        } catch (pe) {
          Logger.error('[AssetLoader] Manifest parse failed (non-JSON) for ' + attempt);
        }
      } catch (err) {
        Logger.warn('[AssetLoader] Manifest attempt failed ' + attempt);
      }
    }
    Logger.error('[AssetLoader] All manifest fetch attempts failed. Using placeholders. Attempts=' + attempts.join(','));
    this.manifest = null;
    return this.manifest;
  }

  public async loadImage(path: string) {
    // Normalize path across hosting modes and attempt multiple variants to survive basePrefix changes
    const normalized = AssetLoader.normalizePath(path);
    const candidates: string[] = [];
    const pushUnique = (p: string) => { if (p && !candidates.includes(p)) candidates.push(p); };
    pushUnique(normalized);
    // Variant: ensure single leading slash (for dev server publicDir)
    pushUnique('/' + normalized.replace(/^\.*\//, '').replace(/^\/+/, ''));
    // Variant: without leading slash (relative)
    pushUnique(normalized.replace(/^\/+/, ''));
    // Variant: remove basePrefix if present
    if (AssetLoader.basePrefix) {
      pushUnique(normalized.replace(AssetLoader.basePrefix, ''));
    }
    // Variant: add basePrefix if missing and path starts with assets
    if (!normalized.startsWith(AssetLoader.basePrefix) && /^(\.?\/)?assets\//.test(normalized)) {
      pushUnique((AssetLoader.basePrefix || '') + '/' + normalized.replace(/^\.?\//, ''));
    }
    // File protocol special-case: prefer './assets/...'
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      const rel = normalized.replace(/^\/?assets\//, './assets/');
      pushUnique(rel);
    }

    // If cached under any candidate, return immediately
    for (const c of candidates) {
      const key = AssetLoader.normalizePath(c);
      if (this.cache[key]) return this.cache[key];
    }

    // Attempt sequential load of candidates
    const tryLoad = (idx: number): Promise<HTMLImageElement> => {
      if (idx >= candidates.length) return Promise.reject(new Error('All image paths failed for ' + path));
      const p = candidates[idx];
      const img = new Image();
      return new Promise((resolve, reject) => {
        img.onload = () => {
          const key = AssetLoader.normalizePath(p);
          this.cache[key] = img;
          resolve(img);
        };
        img.onerror = () => {
          Logger.warn('[AssetLoader] Image load failed, trying next variant', p);
          tryLoad(idx + 1).then(resolve).catch(reject);
        };
        img.src = p;
      });
    };

    try {
      return await tryLoad(0);
    } catch (err) {
      const key = AssetLoader.normalizePath(normalized);
      Logger.warn('[AssetLoader] All variants failed for', path, err);
      const { w, h } = this.getDimsForPath(path);
      const label = this.getName(path);
      const assetInfo = this.getAssetInfo(label);
      const placeholder = this.createPlaceholderImage(w, h, label, assetInfo);
      this.cache[key] = placeholder;
      return placeholder;
    }
  }

  /** Normalize a raw asset path to work under both http(s) and file protocols */
  public static normalizePath(p: string): string {
    if (typeof location === 'undefined') return p;
    if (location.protocol === 'file:') {
      if (p.startsWith('/assets/')) return '.' + p; // '/assets/x.png' -> './assets/x.png'
      if (p.startsWith('assets/')) return './' + p; // 'assets/x.png' -> './assets/x.png'
      return p;
    }
    // http(s) hosting – inject basePrefix if path starts at root /assets
    if (p.startsWith('/assets/')) return AssetLoader.basePrefix + p; // '' or '/cs' prefix
    if (p.startsWith('assets/')) return AssetLoader.basePrefix + '/' + p; // relative form
    return p;
  }

  public async loadAllFromManifest(base?: string) {
    if (!base) {
      if (location.protocol === 'file:') base = './assets';
      else base = AssetLoader.basePrefix + '/assets';
    }
    if (!this.manifest) await this.loadManifest(base + '/manifest.json');
    // Collect file paths (single pass recursion). Preallocate using rough upper bound if available.
    const files: string[] = [];
    const prefix = (location.protocol === 'file:' ? './' : (AssetLoader.basePrefix || '') + '/');
    const walk = (obj: any): void => {
      for (const k in obj) {
        const v = obj[k];
        if (!v) continue;
        if (v.file) {
          files.push(prefix + (v.file as string).replace(/^\//, ''));
        } else if (typeof v === 'object') {
          walk(v);
        }
      }
    };
    walk(this.manifest);
    const promises = files.map((f) => this.loadImage(f));
    await Promise.all(promises);
    return this.manifest;
  }

  public drawFrame(ctx: CanvasRenderingContext2D, path: string, frameX: number, frameY: number, w: number, h: number, dx: number, dy: number) {
    // Try direct, then normalized key
    let img = this.getImage(path);
    if (!img) {
      const norm = AssetLoader.normalizePath(path);
      img = this.getImage(norm);
    }
    if (!img) return;
    ctx.drawImage(img, frameX, frameY, w, h, dx - w / 2, dy - h / 2, w, h);
  }

  public renderAnimatedSprite(ctx: CanvasRenderingContext2D, path: string, frameIndex: number, dx: number, dy: number, frameW?: number, frameH?: number) {
    // Try direct, then normalized key
    let img = this.getImage(path);
    if (!img) {
      const norm = AssetLoader.normalizePath(path);
      img = this.getImage(norm);
    }
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

  public getAsset(key: string): string {
    if (!this.manifest) {
      Logger.warn('[AssetLoader] getAsset called before manifest loaded');
      return '';
    }
    // Recursive search through manifest object for property with matching key
    const search = (obj: any): string => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        if (k === key && v && typeof v === 'object' && v.file) return v.file;
        if (typeof v === 'object') {
          const found = search(v);
          if (found) return found;
        }
      }
      return '';
    };
  let path = search(this.manifest);
  if (!path) return '';
  path = AssetLoader.normalizePath(path);
  return path;
  }
}

// Expose for UI helpers that guard on window.AssetLoader presence
try {
  if (typeof window !== 'undefined') {
    (window as any).AssetLoader = AssetLoader;
  }
} catch {}
