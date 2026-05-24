/**
 * Server-side Recreation.gov RIDB proxy — RIDB blocks browser CORS from production origins.
 */

const BASE_URL = 'https://ridb.recreation.gov/api/v1';

const ALLOWED_PATHS = [
  /^\/facilities$/,
  /^\/facilities\/[A-Za-z0-9_-]+\/campsites$/,
  /^\/facilities\/[A-Za-z0-9_-]+\/media$/,
  /^\/campsites$/,
  /^\/facilityaddresses$/,
  /^\/permitentrances$/,
  /^\/recareas$/,
  /^\/recareaaddresses$/,
  /^\/links$/,
  /^\/media$/,
];

export interface RidbProxyResult {
  status: number;
  text: string;
}

export function normalizeRidbPath(value: string | null | undefined): string | null {
  const raw = value && value.trim() ? value.trim() : '/facilities';
  if (!raw.startsWith('/') || raw.includes('..') || raw.includes('//')) return null;
  const decoded = decodeURIComponent(raw);
  return ALLOWED_PATHS.some((pattern) => pattern.test(decoded)) ? decoded : null;
}

export function buildRidbPathWithQuery(rawUrl: string | undefined): string | null {
  const url = new URL(rawUrl || '/api/ridb', 'http://trailscout.local');
  const path = normalizeRidbPath(url.searchParams.get('path'));
  if (!path) return null;

  const params = new URLSearchParams(url.searchParams);
  params.delete('path');
  params.delete('apikey');
  const built = params.toString();
  return `${path}${built ? `?${built}` : ''}`;
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
