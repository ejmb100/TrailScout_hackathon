/** @typedef {{ status: (code: number) => ApiResponse, setHeader: (name: string, value: string) => void, send: (body: string) => void }} ApiResponse */

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const OVERPASS_USER_AGENT =
  'TrailScout/1.0 (+https://trailscout.vercel.app; contact: overpass-proxy)';

const MIRROR_RETRY_DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOverpassBusyRemark(remark) {
  return /busy|timeout|quota|rate|dispatcher/i.test(remark);
}

function isValidOverpassJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const data = JSON.parse(trimmed);
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

async function queryOverpass(body) {
  let lastStatus = 502;
  let lastText = JSON.stringify({ remark: 'All Overpass mirrors failed' });

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
      lastText = JSON.stringify({ remark: 'Overpass mirror connection failed' });
    }

    if (i < OVERPASS_ENDPOINTS.length - 1) {
      await sleep(MIRROR_RETRY_DELAY_MS);
    }
  }

  return { status: lastStatus, text: lastText };
}

function readOverpassBody(req) {
  const raw = req.body;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw && typeof raw === 'object' && typeof raw.data === 'string' && raw.data.trim()) {
    return `data=${encodeURIComponent(raw.data)}`;
  }
  return '';
}

/** @param {import('http').IncomingMessage & { body?: unknown }} req @param {ApiResponse} res */
module.exports = async function handler(req, res) {
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
};
