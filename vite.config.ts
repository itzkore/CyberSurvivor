import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    open: true,
  },
});
