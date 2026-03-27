import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiForClient = (
    env.VITE_GEMINI_API_KEY ||
    env.GEMINI_API_KEY ||
    ''
  ).trim();
  return {
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 1500,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __TRAILSCOUT_GEMINI__: JSON.stringify(geminiForClient),
      __TRAILSCOUT_RIDB_KEY__: JSON.stringify((env.RIDB_API_KEY || '').trim()),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/elevation': {
          target: 'https://api.open-elevation.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/elevation/, '/api/v1'),
        },
        '/api/3dep': {
          target: 'https://elevation.nationalmap.gov',
          changeOrigin: true,
          rewrite: (p) =>
            p.replace(/^\/api\/3dep/, '/arcgis/rest/services/3DEPElevation/ImageServer'),
        },
      },
    },
  };
});
