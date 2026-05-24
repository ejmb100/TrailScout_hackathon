import type { TrailData, TrailPoint } from './osmService';

const COTREX_TRAILS_QUERY_URL =
  'https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/15/query';

const PAGE_SIZE = 200;
const ID_OFFSET = -2_000_000;
const MILES_TO_KM = 1.609344;

interface CotrexFeature {
  attributes?: Record<string, unknown>;
  geometry?: {
    paths?: number[][][];
  };
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function yesish(v: unknown): boolean {
  return safeStr(v).toLowerCase() === 'yes';
}

function numeric(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstPath(paths: number[][][] | undefined): TrailPoint[] {
  const path = paths?.find((p) => Array.isArray(p) && p.length >= 2) ?? [];
  return path
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => ({
      lng: Math.round(Number(p[0]) * 1e5) / 1e5,
      lat: Math.round(Number(p[1]) * 1e5) / 1e5,
    }));
}

function putTag(tags: Record<string, string>, key: string, value: unknown) {
  const s = safeStr(value);
  if (s) tags[key] = s;
}

export function normalizeCotrexFeature(feature: CotrexFeature): TrailData | null {
  const attrs = feature.attributes ?? {};
  if (!yesish(attrs.hiking)) return null;

  const path = firstPath(feature.geometry?.paths);
  if (path.length < 2) return null;

  const fid = numeric(attrs.FID) ?? numeric(attrs.OBJECTID) ?? numeric(attrs.feature_id) ?? 0;
  const name = safeStr(attrs.name) || safeStr(attrs.trail_num) || safeStr(attrs.trail_num_) || `COTREX Trail ${fid}`;
  const lengthMiles = numeric(attrs.length_mi_);
  const minElevM = numeric(attrs.min_elevat);
  const maxElevM = numeric(attrs.max_elevat);

  const tags: Record<string, string> = {
    trailscout_source: 'cotrex',
    cotrex_feature_id: safeStr(attrs.feature_id) || String(fid),
    source: 'Colorado Trail Explorer (COTREX)',
    hiking: 'yes',
  };

  if (lengthMiles != null && lengthMiles > 0) {
    tags.trailscout_length_km = (lengthMiles * MILES_TO_KM).toFixed(1);
    tags.cotrex_length_mi = lengthMiles.toFixed(1);
  }
  if (minElevM != null) tags.cotrex_min_elevation_m = Math.round(minElevM).toString();
  if (maxElevM != null) tags.cotrex_max_elevation_m = Math.round(maxElevM).toString();

  putTag(tags, 'access', attrs.access);
  putTag(tags, 'dog', attrs.dogs);
  putTag(tags, 'surface', attrs.surface);
  putTag(tags, 'trail_type', attrs.type);
  putTag(tags, 'manager', attrs.manager);
  putTag(tags, 'url', attrs.url);
  putTag(tags, 'seasonal', attrs.seasonalit);
  putTag(tags, 'trail_num', attrs.trail_num || attrs.trail_num_ || attrs.trail_num1);

  return {
    id: ID_OFFSET - fid,
    name,
    path,
    tags,
  };
}

export interface CotrexFetchOptions {
  /** When set, only return trails at least this long (COTREX `length_mi_` field). */
  minLengthMiles?: number;
  maxRecords?: number;
}

async function fetchCotrexTrailsInBBoxInternal(
  south: number,
  west: number,
  north: number,
  east: number,
  options: CotrexFetchOptions = {},
): Promise<TrailData[]> {
  const trails: TrailData[] = [];
  let offset = 0;
  let hasMore = true;
  const maxRecords = options.maxRecords ?? 2_000;
  const lengthFilter =
    options.minLengthMiles != null && options.minLengthMiles > 0
      ? ` AND length_mi_ >= ${options.minLengthMiles}`
      : '';

  try {
    while (hasMore) {
      const params = new URLSearchParams({
        where: `hiking = 'yes' AND access <> 'private'${lengthFilter}`,
        geometry: `${west},${south},${east},${north}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: [
          'FID',
          'feature_id',
          'name',
          'trail_num',
          'trail_num_',
          'trail_num1',
          'surface',
          'type',
          'hiking',
          'dogs',
          'access',
          'min_elevat',
          'max_elevat',
          'length_mi_',
          'manager',
          'url',
          'seasonalit',
        ].join(','),
        returnGeometry: 'true',
        outSR: '4326',
        f: 'json',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
      });

      const res = await fetch(`${COTREX_TRAILS_QUERY_URL}?${params}`);
      if (!res.ok) throw new Error(`COTREX API HTTP ${res.status}`);
      const data = await res.json();
      const features = Array.isArray(data.features) ? data.features as CotrexFeature[] : [];
      for (const feature of features) {
        const trail = normalizeCotrexFeature(feature);
        if (trail) trails.push(trail);
      }
      hasMore = features.length === PAGE_SIZE || Boolean(data.exceededTransferLimit);
      offset += features.length;
      if (features.length === 0 || offset >= maxRecords) hasMore = false;
    }
    const label = options.minLengthMiles
      ? `${trails.length} hiking trails (>= ${options.minLengthMiles} mi)`
      : `${trails.length} hiking trails`;
    console.info(`[COTREX] fetched ${label} for bbox [${south},${west},${north},${east}]`);
    return trails;
  } catch (err) {
    console.warn('[COTREX] fetch failed, continuing without Colorado Trail Explorer data:', err);
    return [];
  }
}

export async function fetchCotrexTrailsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<TrailData[]> {
  return fetchCotrexTrailsInBBoxInternal(south, west, north, east);
}

/** Long COTREX routes for multi-day discovery (authoritative `length_mi_`, not simplified geometry). */
export async function fetchLongCotrexTrailsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
  minLengthMiles = 12,
): Promise<TrailData[]> {
  return fetchCotrexTrailsInBBoxInternal(south, west, north, east, {
    minLengthMiles,
    maxRecords: 500,
  });
}
