import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // Firebase config: env var (Docker/produção) ou arquivo local (dev)
  const firebaseConfigStr = process.env.FIREBASE_CONFIG
    || (() => { try { return fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8'); } catch { return '{}'; } })();
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__FIREBASE_CONFIG__': JSON.stringify(firebaseConfigStr),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: true,
      watch: {
        ignored: [
          '**/.order-counter.json',
          '**/server.js',
          '**/server.ts',
          '**/.gemini/**'
        ]
      }
    },
  };
});
