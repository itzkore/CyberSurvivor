import { defineConfig } from 'vite';

// Use relative base for production so Electron file:// loads work (avoid leading slash causing blank window)
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    open: true,
  },
}));
