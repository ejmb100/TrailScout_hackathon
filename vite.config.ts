import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {viteApiPlugin} from './server/viteApiPlugin';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), viteApiPlugin()],
    build: {
      chunkSizeWarningLimit: 1500,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
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
