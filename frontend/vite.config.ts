import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PaytmResolve AI — frontend build config.
// In dev, /api is proxied straight to the Express backend so the browser
// never has to deal with cross-origin requests or a second port to
// remember. In production the same Express server serves this build's
// dist/ output directly (see backend/src/index.ts), so no proxy is needed
// there at all — everything is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
