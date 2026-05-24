/**
 * Server-side Overpass proxy — avoids browser CORS/rate-limit issues on public mirrors.
 * Used by Vercel `/api/overpass` and the Vite dev middleware.
 */

export const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const;

const OVERPASS_USER_AGENT =
  'TrailScout/1.0 (+https://trailscout.vercel.app; contact: overpass-proxy)';

const MIRROR_RETRY_DELAY_MS = 1200;

export interface OverpassProxyResult {
  status: number;
  text: string;
  endpoint?: string;
}

export function isOverpassBusyRemark(remark: string): boolean {
  return /busy|timeout|quota|rate|dispatcher/i.test(remark);
}

export function isValidOverpassJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const data = JSON.parse(trimmed) as {
      remark?: string;
      osm3s?: { remark?: string };
    };
    const remark =
      typeof data.remark === 'string'
        ? data.remark
        : typeof data.osm3s?.remark === 'string'
          ? data.osm3s.remark
          : '';
    return !(remark && isOverpassBusyRemark(remark));
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Forwards an Overpass POST body (`data=...`) to public mirrors with retries.
 */
export async function queryOverpass(body: string): Promise<OverpassProxyResult> {
  let lastStatus = 502;
  let lastText = JSON.stringify({
    remark: 'All Overpass mirrors failed',
  });

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body,
      });
      const text = await response.text();
      lastStatus = response.status;
      lastText = text;

      if (response.ok && isValidOverpassJson(text)) {
        return { status: 200, text, endpoint };
      }

      console.warn(
        `[overpass-proxy] Mirror ${endpoint} HTTP ${response.status}:`,
        text.trim().slice(0, 180).replace(/\s+/g, ' ')
      );
    } catch (error) {
      console.warn(`[overpass-proxy] Mirror ${endpoint} failed:`, error);
      lastStatus = 502;
      lastText = JSON.stringify({
        remark: 'Overpass mirror connection failed',
      });
    }

    if (i < OVERPASS_ENDPOINTS.length - 1) {
      await sleep(MIRROR_RETRY_DELAY_MS);
    }
  }

  return { status: lastStatus, text: lastText };
}
