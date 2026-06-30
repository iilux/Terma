import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le renderer (React) est servi/buildé par Vite. Le main process Electron
// (electron/) n'est PAS touché par Vite : il tourne en CommonJS et charge
// node-pty nativement — c'est le plus robuste pour un module natif.
export default defineConfig({
  // base relative pour que le build fonctionne en file:// dans l'app packagée
  base: './',
  plugins: [react()],
  server: {
    // on force IPv4 (127.0.0.1) : sinon Vite n'écoute que sur ::1 et
    // wait-on / Electron (qui visent 127.0.0.1) ne s'y connectent jamais.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // node-pty / electron ne doivent jamais être bundlés côté renderer
    rollupOptions: {
      external: ['electron', 'node-pty'],
    },
  },
});
