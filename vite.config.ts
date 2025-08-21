import { defineConfig } from 'vite';

// Pure web build (Electron removed): use root-relative base.
export default defineConfig({
  base: '/',
  root: 'src',
  envDir: '.',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { port: 5173, open: true }
});
