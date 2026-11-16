import { build } from 'esbuild';
import { resolve } from 'node:path';
import {
  formatBuildTimestampPtBr,
  prepareBuildInfo,
  WORKTREE_ROOT,
} from './build-info.mjs';

const buildInfo = prepareBuildInfo();

await build({
  absWorkingDir: WORKTREE_ROOT,
  entryPoints: [resolve(WORKTREE_ROOT, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(WORKTREE_ROOT, 'server.js'),
  external: [
    'express',
    'socket.io',
    'vite',
    'dotenv',
    '@google/genai',
    '@tailwindcss/vite',
    '@vitejs/plugin-react',
    '@supabase/supabase-js',
    'ws',
    'pg',
    'node-forge',
  ],
  define: {
    __BUILD_ID__: JSON.stringify(buildInfo.buildId),
    __BUILD_VERSION__: JSON.stringify(buildInfo.version),
    __BUILD_TS__: JSON.stringify(formatBuildTimestampPtBr(buildInfo.builtAtISO)),
  },
});
