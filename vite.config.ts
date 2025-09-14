import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pure web build (Electron removed): use root-relative base.
export default defineConfig({
  plugins: [react()],
  // Use relative base so the app works when hosted under a subfolder (e.g., https://site.tld/cs/)
  // You can override with BASE env: BASE=/my/sub/base/ npm run build
  base: process.env.BASE || './',
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
