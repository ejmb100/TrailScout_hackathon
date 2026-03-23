/**
 * Runtime campsite data loader — queries the USFS EDW ArcGIS REST API on demand.
 * Provides campsite lookup and trail-proximity snapping for itinerary planning.
 */

import type { TrailPoint } from './osmService';

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0/query';

const PAGE_SIZE = 500;
const RELEVANT_SITE_TYPES = ['CAMPGROUND', 'CAMPING AREA', 'TRAILHEAD'];

export interface Campsite {
  id: number;
  name: string;
  lat: number;
  lng: number;
  siteType: 'campground' | 'camping_area' | 'trailhead';
  water: boolean | null;
  fee: boolean;
  capacity: number | null;
  packInOut: boolean;
  openSeason: string;
  activities: string[];
  permits: string;
  restrictions: string;
}

export interface TrailCampsite extends Campsite {
  trailKm: number;
  offsetKm: number;
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function normSiteType(raw: string): Campsite['siteType'] | null {
  switch (raw) {
    case 'CAMPGROUND': return 'campground';
    case 'CAMPING AREA': return 'camping_area';
    case 'TRAILHEAD': return 'trailhead';
    default: return null;
  }
}

function parseWater(raw: string): boolean | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('yes') || lower.includes('drinking water is available')) return true;
  if (lower.includes('no water') || lower.includes('no ')) return false;
  return null;
}

function parseActivities(raw: string): string[] {
  if (!raw) return [];
  return raw.split('|').map(s => s.trim()).filter(Boolean);
}

/** In-memory cache of fetched campsites, keyed by a bbox string. */
let cachedSites: Campsite[] = [];
let cachedBBox = '';

/**
 * Fetch USFS recreation sites (campgrounds, camping areas, trailheads)
 * for the given bounding box. Results are cached so repeated calls for
 * the same bbox are free.
 */
export async function fetchCampsitesInBBox(
  south: number, west: number, north: number, east: number
): Promise<Campsite[]> {
  const bboxKey = `${south},${west},${north},${east}`;
  if (bboxKey === cachedBBox && cachedSites.length > 0) return cachedSites;

  const siteTypes = RELEVANT_SITE_TYPES.map(t => `'${t}'`).join(',');
  const sites: Campsite[] = [];

  try {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        where: `SITE_TYPE IN (${siteTypes})`,
        geometry: `${west},${south},${east},${north}`,
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: [
          'OBJECTID', 'SITE_NAME', 'SITE_TYPE', 'ACTIVITY_TYPE_LIST',
          'FEE_CHARGED', 'WATER_AVAILABILITY', 'TOTAL_CAPACITY',
          'LATITUDE', 'LONGITUDE', 'PACK_IN_OUT', 'OPEN_SEASON',
          'PERMIT_INFORMATION', 'RESTRICTIONS',
        ].join(','),
        f: 'json',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
      });

      const res = await fetch(`${BASE_URL}?${params}`);
      if (!res.ok) throw new Error(`USFS Campsite API HTTP ${res.status}`);
      const data = await res.json();
      const features = data.features ?? [];

      for (const f of features) {
        const a = f.attributes ?? {};
        const lat = Number(a.LATITUDE);
        const lng = Number(a.LONGITUDE);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) continue;

        const siteType = normSiteType(safeStr(a.SITE_TYPE));
        if (!siteType) continue;

        sites.push({
          id: Number(a.OBJECTID) || sites.length,
          name: safeStr(a.SITE_NAME) || 'Unnamed Site',
          lat: Math.round(lat * 1e5) / 1e5,
          lng: Math.round(lng * 1e5) / 1e5,
          siteType,
          water: parseWater(safeStr(a.WATER_AVAILABILITY)),
          fee: safeStr(a.FEE_CHARGED) === 'Y',
          capacity: Number(a.TOTAL_CAPACITY) || null,
          packInOut: safeStr(a.PACK_IN_OUT) === 'Y',
          openSeason: safeStr(a.OPEN_SEASON),
          activities: parseActivities(safeStr(a.ACTIVITY_TYPE_LIST)),
          permits: safeStr(a.PERMIT_INFORMATION),
          restrictions: safeStr(a.RESTRICTIONS),
        });
      }

      if (features.length < PAGE_SIZE && !data.exceededTransferLimit) {
        hasMore = false;
      } else {
        offset += features.length;
      }
    }

    cachedSites = sites;
    cachedBBox = bboxKey;
    console.info(`[USFS Campsite API] fetched ${sites.length} sites for bbox [${south},${west},${north},${east}]`);
  } catch (err) {
    console.warn('[USFS Campsite API] fetch failed, continuing without campsite data:', err);
  }

  return sites;
}

// ── Trail snapping utilities (unchanged) ───────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const R_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return R_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function cumulativeDistances(path: TrailPoint[]): number[] {
  const dists = [0];
  for (let i = 1; i < path.length; i++) {
    dists.push(dists[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  return dists;
}

function snapToPath(
  site: { lat: number; lng: number },
  path: TrailPoint[],
  cumDist: number[]
): { trailKm: number; offsetKm: number } {
  let bestTrailKm = 0;
  let bestOffset = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = cumDist[i + 1] - cumDist[i];
    if (segLen < 0.001) continue;

    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG_TO_RAD);
    const ax = a.lng * cosLat, ay = a.lat;
    const bx = b.lng * cosLat, by = b.lat;
    const sx = site.lng * cosLat, sy = site.lat;

    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / (dx * dx + dy * dy)));

    const projLat = a.lat + t * (b.lat - a.lat);
    const projLng = a.lng + t * (b.lng - a.lng);
    const offset = haversineKm(site, { lat: projLat, lng: projLng });

    if (offset < bestOffset) {
      bestOffset = offset;
      bestTrailKm = cumDist[i] + t * segLen;
    }
  }

  return { trailKm: Math.round(bestTrailKm * 10) / 10, offsetKm: Math.round(bestOffset * 10) / 10 };
}

const MAX_OFFSET_KM = 3.0;

/**
 * Find campsites near a trail, sorted by distance along the trail.
 * Uses the most recently fetched campsite data from fetchCampsitesInBBox.
 */
export function getCampsitesAlongTrail(
  path: TrailPoint[],
  options?: { maxOffsetKm?: number; includeTruilheads?: boolean }
): TrailCampsite[] {
  if (path.length < 2) return [];

  const maxOff = options?.maxOffsetKm ?? MAX_OFFSET_KM;
  const includeTrailheads = options?.includeTruilheads ?? true;
  const cumDist = cumulativeDistances(path);

  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const pad = maxOff / 111;
  minLat -= pad; maxLat += pad; minLng -= pad; maxLng += pad;

  const results: TrailCampsite[] = [];

  for (const site of cachedSites) {
    if (!includeTrailheads && site.siteType === 'trailhead') continue;
    if (site.lat < minLat || site.lat > maxLat || site.lng < minLng || site.lng > maxLng) continue;

    const { trailKm, offsetKm } = snapToPath(site, path, cumDist);
    if (offsetKm <= maxOff) {
      results.push({ ...site, trailKm, offsetKm });
    }
  }

  results.sort((a, b) => a.trailKm - b.trailKm);
  return results;
}

export function trailLengthKm(path: TrailPoint[]): number {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) d += haversineKm(path[i], path[i + 1]);
  return d;
}

export function getCampsiteVintage(): { fetchedAt: string; attribution: string } {
  return {
    fetchedAt: new Date().toISOString(),
    attribution: 'Recreation site data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Verify current availability at recreation.gov or fs.usda.gov.',
  };
}

export function getCampsiteCount(): number {
  return cachedSites.length;
}
