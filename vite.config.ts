import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pure web build (Electron removed). Use base='/' in dev to avoid '/src' base collisions,
// and allow subfolder-friendly base only for production builds.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // In dev, always use '/'. In build, allow overriding via BASE env or default to './'.
  base: command === 'serve' ? '/' : (process.env.BASE || './'),
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
}));
