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
  // Preload integrity check
  try {
    const preloadOk = (window as any).cs && (window as any).cs.meta && (window as any).cs.meta.version === '1.0.0';
    if (!preloadOk) {
      Logger.error('[main.ts] Preload API integrity failed: missing or incorrect version');
    } else {
      Logger.info('[main.ts] Preload API version ' + (window as any).cs.meta.version + ' verified');
    }
  } catch (e) {
    Logger.error('[main.ts] Preload integrity exception', e);
  }
  // --- Preload integrity check ---
  try {
    const preloadOk = (window as any).cs && (window as any).cs.meta && (window as any).cs.meta.version === '1.0.0';
    if (!preloadOk) {
      Logger.error('[main.ts] Preload API integrity failed (missing or wrong version)');
    } else {
      Logger.info('[main.ts] Preload API version ' + (window as any).cs.meta.version + ' verified');
    }
  } catch (e) {
    Logger.error('[main.ts] Preload API integrity exception', e);
  }
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

  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.margin = '0';
  canvas.style.padding = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '-1';
  canvas.style.display = 'block';
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

  await game.init();
  Logger.info('[main.ts] Game assets loaded');
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
    const musicPathInit = (location.protocol === 'file:' ? './assets/music/bg-music.mp3' : '/assets/music/bg-music.mp3');
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
      const musicPath = (location.protocol === 'file:' ? './assets/music/bg-music.mp3' : '/assets/music/bg-music.mp3');
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
    const selectedCharData = customEvent.detail;
    Logger.info('[main.ts] startGame event received, selectedCharData:', selectedCharData);
    game.resetGame(selectedCharData); // Reset game with selected character
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
