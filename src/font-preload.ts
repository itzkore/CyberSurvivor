// Preload Orbitron font weights used in loading/menu/HUD without inline script (CSP-safe)
try {
  const fs: any = (document as any).fonts;
  if (fs && fs.load) {
    const p = Promise.all([
      fs.load("600 18px 'Orbitron'"),
      fs.load("700 20px 'Orbitron'"),
      fs.load("800 24px 'Orbitron'"),
      fs.load("900 54px 'Orbitron'")
    ]).catch(() => { /* ignore */ });
    (window as any).__fontsReadyPromise = p;
  }
} catch {
  /* ignore */
}
