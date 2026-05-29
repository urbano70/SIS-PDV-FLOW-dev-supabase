import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // Prioridade: env var (produção) → arquivo .dev.json (dev local) → arquivo padrão
  const firebaseConfigStr = process.env.FIREBASE_CONFIG
    || (() => { try { return fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.dev.json'), 'utf-8'); } catch { return null; } })()
    || (() => { try { return fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8'); } catch { return '{}'; } })();
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
            },
          ],
        },
      }),
    ],
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
      port: 3002,
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
      watch: {
        ignored: [
          '**/.order-counter.json',
          '**/server.js',
          '**/server.ts',
          '**/server.cjs',
          '**/.gemini/**'
        ]
      }
    },
  };
});
