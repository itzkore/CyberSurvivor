// Entry point for the game
import { Game } from './game/Game';
import { MainMenu } from './ui/MainMenu';
import { CharacterSelectPanel } from './ui/CharacterSelectPanel'; // Import CharacterSelectPanel
import { Logger } from './core/Logger'; // Import Logger
import { ensurePauseOverlay } from './ui/PauseOverlay';
import { ensureGameOverOverlay } from './ui/GameOverOverlay';

/** Lightweight frame snapshot for worker (packed minimal fields). */
interface WorkerFrame {
  camX:number; camY:number; scale:number;
  player?: { x:number; y:number; r:number };
  enemies: { x:number; y:number; r:number; hp:number; max:number }[];
  bullets: { x:number; y:number; r:number }[];
}

function applyCanvasSizeGlobal(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

window.onload = async () => {
  // Lightweight loading overlay for slow connections
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-overlay';
  loadingDiv.style.position = 'fixed';
  loadingDiv.style.inset = '0';
  loadingDiv.style.background = 'radial-gradient(circle at 50% 40%, #062025 0%, #020a0c 80%)';
  loadingDiv.style.display = 'flex';
  loadingDiv.style.flexDirection = 'column';
  loadingDiv.style.alignItems = 'center';
  loadingDiv.style.justifyContent = 'center';
  loadingDiv.style.font = '600 18px Orbitron, sans-serif';
  loadingDiv.style.color = '#26ffe9';
  loadingDiv.style.letterSpacing = '1px';
  loadingDiv.style.zIndex = '9999';
  loadingDiv.innerHTML = `<div style="margin-bottom:18px;font-size:28px;text-shadow:0 0 12px #00ffc8">CYBERSURVIVOR</div>
    <div id="load-bar" style="width:320px;height:14px;outline:1px solid #0aa;position:relative;background:rgba(0,40,48,0.5);overflow:hidden">
      <div id="load-bar-fill" style="position:absolute;left:0;top:0;height:100%;width:0;background:linear-gradient(90deg,#26ffe9,#00b3a3);"></div>
    </div>
  <div id="load-status" style="margin-top:10px;font-size:12px;color:#9fe;opacity:0.85">Initializing...</div>`;
  document.body.appendChild(loadingDiv);

  function updateLoading(progress:number, label:string){
    const fill = document.getElementById('load-bar-fill') as HTMLDivElement | null;
    const status = document.getElementById('load-status');
    if (fill) fill.style.width = Math.min(100, Math.round(progress*100)) + '%';
    if (status) status.textContent = label;
  }
  function hideLoadingOverlay(immediate=false){
    const ov = document.getElementById('loading-overlay');
    if (!ov) return;
    if (immediate){ ov.remove(); return; }
    ov.setAttribute('data-hide','1');
    ov.style.transition='opacity 0.55s';
    ov.style.opacity='0';
    setTimeout(()=>{ if (ov && ov.parentNode) ov.remove(); }, 650);
  }
  // Absolute safety fallback: force remove after 12s even if something broke earlier
  setTimeout(()=> hideLoadingOverlay(false), 12000);

  // Electron preload integration removed – no runtime preload validation needed.
  // --- Cinematic skip button click handler ---
  // Move click handler after canvas is assigned
  setTimeout(() => {
    canvas.addEventListener('mousedown', (e) => {
      if (!game.cinematic || !game.cinematic.active) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cinematicAny = game.cinematic as any;
      if (cinematicAny && typeof cinematicAny.handleClick === 'function' && cinematicAny.handleClick(x, y, canvas)) {
        Logger.info('[main.ts] Cinematic skipped via button');
      }
    });
  }, 0);
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) {
    Logger.error('Canvas element with ID "gameCanvas" not found.');
    return;
  }

  canvas.classList.add('game-canvas-root');
  applyCanvasSizeGlobal(canvas);

  const game = new Game(canvas); // Instantiate Game first
  (window as any).__game = game; // expose for resize handling
  // Experimental Offscreen worker DISABLED for now (caused start-game stutter due to large postMessage payloads).
  // Leave scaffold for future refinement.
  // (window as any).__workerRender = false;
  // FPS & performance overlays removed; HUD now renders in-canvas FPS.

  // --- Optional Offscreen worker renderer (enable via ?worker=1) ---
  const useWorker = /[?&]worker=1/.test(location.search) && (window as any).OffscreenCanvas;
  let worker: Worker | null = null;
  if (useWorker) {
    try {
      worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen, width: canvas.width, height: canvas.height }, [offscreen]);
      // Hook after in-thread render logic to send snapshot (very lightweight arrays)
      (game as any).gameLoop?.setRenderHook?.(() => {
        // Build compact snapshot without allocating large new arrays each frame
        const enemiesSrc = game.getEnemyManager().getEnemies();
        const bulletsSrc = game.getBulletManager().bullets;
        const eLen = enemiesSrc.length;
        const bLen = bulletsSrc.length;
        const enemies: WorkerFrame['enemies'] = new Array(eLen);
        for (let i=0;i<eLen;i++) {
          const e:any = enemiesSrc[i];
          enemies[i] = { x:e.x, y:e.y, r:e.radius, hp:e.hp, max:e.maxHp };
        }
        const bullets: WorkerFrame['bullets'] = new Array(bLen);
        for (let i=0;i<bLen;i++) {
          const b:any = bulletsSrc[i];
          bullets[i] = { x:b.x, y:b.y, r:b.radius };
        }
        const frame: WorkerFrame = {
          camX: (game as any).camX ?? 0,
          camY: (game as any).camY ?? 0,
          scale: 1,
          player: { x: game.player.x, y: game.player.y, r: game.player.radius },
          enemies,
          bullets
        };
        worker?.postMessage({ type:'frame', payload: frame });
      });
    } catch (err) {
      console.warn('[main] Worker init failed, reverting to main-thread render', err);
    }
  }
  const mainMenu = new MainMenu(game); // Pass game instance to MainMenu
  // Instantiate pause overlay immediately so Escape can show it right away
  const pauseOverlay = ensurePauseOverlay(game);
  // Instantiate game over overlay early so event will show it instantly
  const gameOverOverlay = ensureGameOverOverlay(game);
  // Robust capture-phase ESC handler (prevents race conditions / missed pause)
  let escToggleGuard = 0; // timestamp of last ESC handling
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Basic debounce (~75ms) to avoid double toggle from multiple listeners
    const now = performance.now();
    if (now - escToggleGuard < 75) return;
    escToggleGuard = now;
    const st = game.getState ? game.getState() : (game as any).state;
    if (st === 'GAME') {
      e.preventDefault();
      game.pause();
    } else if (st === 'PAUSE') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('resumeGame'));
    }
  }, true); // capture phase so it runs before other handlers
  // Gate showing the pause overlay strictly to when the internal state is PAUSE
  window.addEventListener('showPauseOverlay', (e: Event) => {
    const st = game.getState ? game.getState() : (game as any).state;
    if (st !== 'PAUSE') {
      Logger.warn('[main.ts] showPauseOverlay ignored, state =', st);
      return; // Prevent showing before gameplay has started
    }
    const detail = (e as CustomEvent).detail || {};
    pauseOverlay.show(!!detail.auto);
    Logger.info('[main.ts] Pause overlay shown (auto=' + (!!detail.auto) + ')');
  });
  window.addEventListener('hidePauseOverlay', () => pauseOverlay.hide());

  // Now pass UI panels to game after they are instantiated
  game.setMainMenu(mainMenu);

  // Initial state setup
  game.setState('MAIN_MENU');
  Logger.info('[main.ts] Initial state set to MAIN_MENU');

  try {
    // Progressive manifest load & image prefetch with updates
  updateLoading(0.05, 'Loading manifest');
    try {
      await (game as any).assetLoader?.loadManifest();
    } catch (e){ Logger.warn('[main.ts] Manifest load fail (continuing)', e); }
  updateLoading(0.15, 'Preparing environment');
    // Core init
    await game.init();
  updateLoading(0.32, 'Initializing systems');
    try {
      const loader: any = (game as any).assetLoader;
      const manifest = loader?.manifest;
      if (manifest) {
        const files:string[] = [];
        const walk=(o:any)=>{ for(const k in o){ const v=o[k]; if(!v) continue; if(v.file) files.push(v.file); else if(typeof v==='object') walk(v);} };
        walk(manifest);
        const total = files.length || 1;
        const prefix = (window as any).AssetLoader?.basePrefix || '';
        let loaded = 0;
        for (let i=0;i<files.length;i+=4){
          const batch = files.slice(i,i+4).map(f=> loader.loadImage(prefix + (f.startsWith('/')? f : '/'+f)).catch(()=>null));
          await Promise.all(batch);
          loaded = Math.min(files.length, i+4);
          updateLoading(0.32 + 0.58*(loaded/total), 'Loading assets '+loaded+'/'+total);
        }
      }
    } catch (e){ Logger.warn('[main.ts] Progressive asset load issue', e); }
  updateLoading(0.94, 'Finalizing...');
    Logger.info('[main.ts] Game assets loaded');
  } catch (fatal) {
  updateLoading(1, 'Loading error');
    Logger.error('[main.ts] Fatální chyba během načítání', fatal);
    // Provide basic retry button
    const status = document.getElementById('load-status');
    if (status){
      const btn = document.createElement('button');
      btn.textContent = 'Reload';
      btn.style.marginTop='12px';
      btn.onclick=()=> location.reload();
      status.appendChild(btn);
    }
  }
  // Enable variable timestep mode (systems now scale by delta). Can disable via console: __game.gameLoop.setVariableTimestep(false)
  (game as any).gameLoop?.setVariableTimestep?.(true);

  // Manifest already loaded inside game.init() via loadAllFromManifest; avoid redundant second fetch.

  // Instantiate CharacterSelectPanel after assets are loaded
  const characterSelectPanel = new CharacterSelectPanel();
  game.setCharacterSelectPanel(characterSelectPanel);

  // Instantiate UpgradePanel after player is initialized
  import('./ui/UpgradePanel').then(({ UpgradePanel }) => {
    const upgradePanel = new UpgradePanel(game.player, game);
    game.setUpgradePanel(upgradePanel);
    Logger.info('[main.ts] UpgradePanel instantiated and set.');
  });

  // Preload background music (no autoplay to avoid policy block)
  import('./game/SoundManager').then(({ SoundManager }) => {
  const musicPathInit = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/music/bg-music.mp3') : (location.protocol==='file:'?'./assets/music/bg-music.mp3':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/music/bg-music.mp3':'/assets/music/bg-music.mp3'));
    SoundManager.preloadMusic(musicPathInit);
    // Also arm early start: first user gesture (click / key) in main menu triggers playback.
    // This keeps autoplay policy compliant while giving ambience before gameplay.
    const earlyHandler = () => {
      if (!musicStarted) startMusic(false);
      window.removeEventListener('pointerdown', earlyHandler);
      window.removeEventListener('keydown', earlyHandler);
    };
    window.addEventListener('pointerdown', earlyHandler, { once: true });
    window.addEventListener('keydown', earlyHandler, { once: true });
  });

  game.start();
  Logger.info('[main.ts] Game loop started');
  // Fade out loading overlay
  setTimeout(()=>{ updateLoading(1,'Finalizing...'); hideLoadingOverlay(false); }, 150);
  // Also hide immediately once first main menu frame is shown
  requestAnimationFrame(()=> requestAnimationFrame(()=> hideLoadingOverlay(false)));

  // Responsive resize: adjust canvas + game logical size on window resize
  const handleResize = () => {
    applyCanvasSizeGlobal(canvas);
    game.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  // In case of orientation change / zoom adjustments
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 50));

  // (Render hook removed while worker disabled.)

  mainMenu.show(); // Show the main menu initially
  Logger.info('[main.ts] Main menu shown');

  // --- Sound Settings Panel & Music ---
  // Sound settings now only accessible via Pause -> Options; no auto panel on gameplay start
  // Hudba se spustí až po startu hry (po interakci uživatele)
  let musicStarted = false;
  function startMusic(forceReload = false) {
    if (musicStarted && !forceReload) return;
    import('./game/SoundManager').then(({ SoundManager }) => {
  const musicPath = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/music/bg-music.mp3') : (location.protocol==='file:'?'./assets/music/bg-music.mp3':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/music/bg-music.mp3':'/assets/music/bg-music.mp3'));
      SoundManager.playMusic(musicPath, forceReload);
      Logger.info('[main.ts] Background music playMusic invoked (forceReload=' + forceReload + ')');
      musicStarted = true;
      // Fallback: if still not playing after 2s, attach one-shot gesture to force reload
      setTimeout(()=>{
        try {
          const sm: any = (SoundManager as any);
          // call debug
          (SoundManager as any).debugStatus?.();
          if ((SoundManager as any).bgMusic && !(SoundManager as any).bgMusic.playing()) {
            const forceHandler = () => {
              document.removeEventListener('pointerdown', forceHandler);
              document.removeEventListener('keydown', forceHandler);
              startMusic(true); // force reload with cache bust
            };
            document.addEventListener('pointerdown', forceHandler, { once:true });
            document.addEventListener('keydown', forceHandler, { once:true });
            Logger.warn('[main.ts] Music still not playing; waiting for user gesture to force reload.');
          }
        } catch {/* ignore */}
      }, 2000);
    });
  }

  window.addEventListener('startGame', (event: Event) => {
  // Hide legacy floating sound panel if it exists (now only inside pause overlay)
  const legacySound = document.getElementById('sound-settings-panel');
  if (legacySound) legacySound.style.display = 'none';
  startMusic(false); // play after user interaction
    const customEvent = event as CustomEvent;
    const payload: any = customEvent.detail;
    const selectedCharData = payload.character || payload; // backward compatibility
    if (payload.mode) {
      (game as any).gameMode = payload.mode;
      Logger.info('[main.ts] Game mode set to ' + payload.mode);
    }
    Logger.info('[main.ts] startGame event received, selectedCharData:', selectedCharData);
    game.resetGame(selectedCharData); // Reset game with selected character & mode
    mainMenu.hide();
    Logger.info('[main.ts] Main menu hidden, starting cinematic and game');
    // Ensure canvas is visible and on top
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
    game.startCinematicAndGame(); // Start cinematic and then game
  });

  window.addEventListener('showCharacterSelect', () => {
    Logger.info('[main.ts] showCharacterSelect event received');
    mainMenu.hide();
    characterSelectPanel.show();
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });

  window.addEventListener('showMainMenu', () => {
    Logger.info('[main.ts] showMainMenu event received');
  characterSelectPanel.hide(); // Hide character select if coming from there
  try { game.stopToMainMenu(); } catch {}
    mainMenu.show();
    canvas.style.zIndex = '-1';
  try { game.onReturnToMainMenu(); } catch { /* ignore if not yet defined */ }
  });

  window.addEventListener('backToMenu', () => {
    Logger.info('[main.ts] backToMenu event received');
    characterSelectPanel.hide();
    mainMenu.show();
    canvas.style.zIndex = '-1';
  });

  window.addEventListener('pauseGame', () => {
    Logger.info('[main.ts] pauseGame event received');
    game.pause(); // Game.pause() will emit showPauseOverlay only if state transitioned from GAME
  });

  window.addEventListener('resumeGame', () => {
    Logger.info('[main.ts] resumeGame event received');
    game.resume(); // Game.resume() emits hidePauseOverlay itself
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });

  // Show upgrade panel on player level up
  window.addEventListener('levelup', () => {
    Logger.info('[main.ts] levelup event received, dispatching showUpgradePanel');
    window.dispatchEvent(new CustomEvent('showUpgradePanel'));
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });
  // Matrix background now managed by MatrixBackground singleton (auto on show/hide)

  // Fallback Escape (kept minimal) if game listener not yet attached
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const g: any = (window as any).__game;
    if (!g) return;
    const st = g.getState ? g.getState() : g.state;
    if (st === 'GAME') g.pause();
    else if (st === 'PAUSE') window.dispatchEvent(new CustomEvent('resumeGame'));
    // Ignore in menus / character select / cinematic
  });
};

window.onresize = () => {
  const canvasEl = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
  if (canvasEl) applyCanvasSizeGlobal(canvasEl);
  const g = (window as any).__game as Game | undefined;
  if (g) g.resize(window.innerWidth, window.innerHeight);
};
