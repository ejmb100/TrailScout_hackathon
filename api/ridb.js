/** @typedef {{ status: (code: number) => ApiResponse, setHeader: (name: string, value: string) => void, send: (body: string) => void }} ApiResponse */

const BASE_URL = 'https://ridb.recreation.gov/api/v1';

async function queryRidb(pathWithQuery, apiKey) {
  if (!apiKey.trim()) {
    return {
      status: 503,
      text: JSON.stringify({ error: 'RIDB API key not configured on server' }),
    };
  }

  const url = `${BASE_URL}${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TrailScout/1.0 (+https://trailscout.vercel.app)',
      },
    });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    console.warn('[ridb-proxy] fetch failed:', error);
    return {
      status: 502,
      text: JSON.stringify({ error: 'RIDB proxy request failed' }),
    };
  }
}

function queryString(req) {
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

/** @param {import('http').IncomingMessage & { query?: Record<string, string | string[]>, url?: string }} req @param {ApiResponse} res */
module.exports = async function handler(req, res) {
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
};
