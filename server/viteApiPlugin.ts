import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { queryOverpass } from './overpassProxy';
import { queryRidb } from './ridbProxy';

/** Vite dev middleware — mirrors Vercel `/api/*` routes locally. */
export function viteApiPlugin(): Plugin {
  return {
    name: 'trailscout-api-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');

      server.middlewares.use('/api/overpass', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          void (async () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const result = await queryOverpass(body);
              res.statusCode = result.status;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(result.text);
            } catch (error) {
              console.error('[overpass-proxy] Dev middleware failed:', error);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ remark: 'Overpass proxy failed' }));
            }
          })();
        });
      });

      server.middlewares.use('/api/ridb', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        void (async () => {
          const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
          const apiKey = (env.RIDB_API_KEY || '').trim();
          const result = await queryRidb(`/facilities${query}`, apiKey);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(result.text);
        })();
      });
    },
  };
}
