import { queryOverpass } from './lib/overpassProxy';

interface ApiRequest {
  method?: string;
  body?: string | Buffer | { data?: string };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
}

function readOverpassBody(req: ApiRequest): string {
  const raw = req.body;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw && typeof raw === 'object' && typeof raw.data === 'string' && raw.data.trim()) {
    return `data=${encodeURIComponent(raw.data)}`;
  }
  return '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const body = readOverpassBody(req);

  if (!body.trim()) {
    res.status(400).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ error: 'Missing Overpass query body' }));
    return;
  }

  try {
    const result = await queryOverpass(body);
    res.status(result.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.text);
  } catch (error) {
    console.error('[overpass-proxy] Vercel handler failed:', error);
    res.status(502).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ remark: 'Overpass proxy failed' }));
  }
}
