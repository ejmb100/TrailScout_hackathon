import type { Plugin } from 'vite';
import { queryOverpass } from './overpassProxy';

/** Vite dev middleware — same behavior as Vercel `/api/overpass`. */
export function viteOverpassPlugin(): Plugin {
  return {
    name: 'trailscout-overpass-proxy',
    configureServer(server) {
      server.middlewares.use('/api/overpass', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('error', () => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Request body error' }));
          }
        });
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
    },
  };
}
