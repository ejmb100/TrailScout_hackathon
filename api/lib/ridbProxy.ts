/**
 * Server-side Recreation.gov RIDB proxy — RIDB blocks browser CORS from production origins.
 * Lives under `api/lib/` so Vercel bundles it with serverless handlers.
 */

const BASE_URL = 'https://ridb.recreation.gov/api/v1';

export interface RidbProxyResult {
  status: number;
  text: string;
}

export async function queryRidb(pathWithQuery: string, apiKey: string): Promise<RidbProxyResult> {
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
