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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('howler')) return 'vendor';
            return 'vendor';
          }
          if (id.includes('ui/')) return 'ui';
          if (id.includes('game/')) return 'game';
          if (id.includes('core/')) return 'core';
          if (id.includes('auth/')) return 'auth';
          if (id.includes('physics/')) return 'physics';
          return 'main';
        }
      }
    }
  },
  server: { port: 5173, open: true }
});
