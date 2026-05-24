import { queryRidb } from './lib/ridbProxy';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
}

function queryString(req: ApiRequest): string {
  const fromUrl = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (fromUrl) return fromUrl;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value != null) {
      params.set(key, value);
    }
  }
  const built = params.toString();
  return built ? `?${built}` : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = (process.env.RIDB_API_KEY || '').trim();
  const path = '/facilities' + queryString(req);

  try {
    const result = await queryRidb(path, apiKey);
    res.status(result.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.text);
  } catch (error) {
    console.error('[ridb-proxy] Vercel handler failed:', error);
    res.status(502).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'RIDB proxy failed' }));
  }
}
