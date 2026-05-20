/**
 * Runtime USFS trail data loader — queries the EDW ArcGIS REST API on demand.
 * Only fetches trails intersecting the search bbox, eliminating the need to
 * bundle a multi-MB static file.
 */

import type { TrailData, TrailPoint } from './osmService';

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query';

const PAGE_SIZE = 1000;
const ID_OFFSET = -900_000;
const MAX_POINTS_PER_TRAIL = 200;

const FOREST_NAMES: Record<string, string> = {
  '0203': 'Medicine Bow-Routt NF',
  '0204': 'San Juan NF',
  '0205': 'Grand Mesa/Uncompahgre/Gunnison NF',
  '0206': 'Pike-San Isabel NF',
  '0207': 'Arapaho-Roosevelt NF',
  '0208': 'Rio Grande NF',
  '0210': 'White River NF',
};

const WILDERNESS_AREAS: { name: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { name: 'Weminuche Wilderness', minLat: 37.45, maxLat: 37.95, minLon: -107.75, maxLon: -107.05 },
  { name: 'Maroon Bells–Snowmass Wilderness', minLat: 38.95, maxLat: 39.25, minLon: -107.15, maxLon: -106.85 },
  { name: 'Flat Tops Wilderness', minLat: 39.75, maxLat: 40.15, minLon: -107.5, maxLon: -107.0 },
  { name: 'Eagles Nest Wilderness', minLat: 39.55, maxLat: 39.85, minLon: -106.3, maxLon: -106.0 },
  { name: 'Holy Cross Wilderness', minLat: 39.38, maxLat: 39.58, minLon: -106.55, maxLon: -106.25 },
  { name: 'Indian Peaks Wilderness', minLat: 39.95, maxLat: 40.15, minLon: -105.75, maxLon: -105.55 },
  { name: 'Mount Zirkel Wilderness', minLat: 40.55, maxLat: 40.85, minLon: -106.85, maxLon: -106.55 },
  { name: 'Collegiate Peaks Wilderness', minLat: 38.85, maxLat: 39.1, minLon: -106.5, maxLon: -106.2 },
  { name: 'Sangre de Cristo Wilderness', minLat: 37.8, maxLat: 38.15, minLon: -105.65, maxLon: -105.4 },
  { name: 'La Garita Wilderness', minLat: 37.8, maxLat: 38.1, minLon: -106.95, maxLon: -106.65 },
  { name: 'South San Juan Wilderness', minLat: 37.1, maxLat: 37.45, minLon: -106.8, maxLon: -106.4 },
  { name: 'Lizard Head Wilderness', minLat: 37.75, maxLat: 37.95, minLon: -108.0, maxLon: -107.75 },
  { name: 'Lost Creek Wilderness', minLat: 39.1, maxLat: 39.4, minLon: -105.6, maxLon: -105.25 },
  { name: 'Mount Evans Wilderness', minLat: 39.55, maxLat: 39.7, minLon: -105.65, maxLon: -105.5 },
];

function forestNameFromOrg(org: string): string {
  for (const [prefix, name] of Object.entries(FOREST_NAMES)) {
    if (org.startsWith(prefix)) return name;
  }
  return 'USFS';
}

function classifyWilderness(path: TrailPoint[]): string | undefined {
  if (path.length === 0) return undefined;
  const mid = path[Math.floor(path.length / 2)];
  for (const w of WILDERNESS_AREAS) {
    if (mid.lat >= w.minLat && mid.lat <= w.maxLat && mid.lng >= w.minLon && mid.lng <= w.maxLon) {
      return w.name;
    }
  }
  return undefined;
}

function samplePath(path: TrailPoint[], maxPts: number): TrailPoint[] {
  if (path.length <= maxPts) return path;
  const step = (path.length - 1) / (maxPts - 1);
  const out: TrailPoint[] = [];
  for (let i = 0; i < maxPts - 1; i++) out.push(path[Math.round(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

function compactPoint(p: TrailPoint): TrailPoint {
  return { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 };
}

function coordsToPath(coords: number[][] | number[][][]): TrailPoint[] {
  const flat: number[][] = Array.isArray(coords[0]?.[0])
    ? (coords as number[][][]).flat()
    : (coords as number[][]);
  return flat
    .filter(c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(c => ({ lat: c[1], lng: c[0] }));
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function pathLengthKm(path: TrailPoint[]): number {
  const DEG = Math.PI / 180;
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dLat = (b.lat - a.lat) * DEG, dLng = (b.lng - a.lng) * DEG;
    const sinLat = Math.sin(dLat / 2), sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * sinLng * sinLng;
    d += 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return d;
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: number[][] | number[][][] };
}

async function fetchPage(
  south: number, west: number, north: number, east: number,
  offset: number
): Promise<{ features: GeoJsonFeature[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'OBJECTID,TRAIL_NAME,TRAIL_NO,TRAIL_TYPE,TRAIL_CLASS,MANAGED_USE,SURFACE_TYPE,SPECIAL_MGMT_AREA,MANAGING_ORG,ADMIN_ORG,ACCESSIBILITY_STATUS',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });
  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`USFS API HTTP ${res.status}`);
  const data = await res.json();
  return {
    features: data.features ?? [],
    exceededTransferLimit: Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit),
  };
}

/** Track the most recent fetch for vintage / attribution UI. */
let lastFetchMeta = {
  fetchedAt: '',
  region: 'USFS',
  attribution: 'Trail data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Not for navigation.',
};

/** Track all fetched trail IDs so isOfficialTrail works after fetch. */
const fetchedTrailIds = new Set<number>();
const fetchedTrailIndex = new Map<number, TrailData>();

/**
 * Fetch USFS trails from the EDW API for the given bbox.
 * Returns normalized TrailData[] ready for merging with OSM trails.
 */
export async function fetchOfficialTrailsInBBox(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<TrailData[]> {
  const trails: TrailData[] = [];
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const page = await fetchPage(south, west, north, east, offset);
      for (const f of page.features) {
        const geom = f.geometry;
        if (!geom?.coordinates) continue;
        const rawPath = coordsToPath(geom.coordinates);
        if (rawPath.length < 2) continue;

        const props = f.properties ?? {};
        const objectId = Number(props.OBJECTID ?? props.FID ?? trails.length);
        const id = ID_OFFSET - objectId;
        const path = samplePath(rawPath, MAX_POINTS_PER_TRAIL).map(compactPoint);
        const name = safeStr(props.TRAIL_NAME) || safeStr(props.TRAIL_NO) || `USFS Trail ${objectId}`;
        const org = safeStr(props.ADMIN_ORG) || safeStr(props.MANAGING_ORG);

        const tags: Record<string, string> = {
          trailscout_source: 'usfs_nfs',
          forest_name: forestNameFromOrg(org),
          trailscout_length_km: pathLengthKm(path).toFixed(1),
        };
        if (safeStr(props.TRAIL_NO)) tags.usfs_trail_no = safeStr(props.TRAIL_NO);
        if (safeStr(props.TRAIL_TYPE)) tags.trail_type = safeStr(props.TRAIL_TYPE);
        if (safeStr(props.TRAIL_CLASS)) tags.trail_class = safeStr(props.TRAIL_CLASS);
        if (safeStr(props.MANAGED_USE)) tags.managed_use = safeStr(props.MANAGED_USE);
        if (safeStr(props.SURFACE_TYPE)) tags.surface_type = safeStr(props.SURFACE_TYPE);
        if (safeStr(props.SPECIAL_MGMT_AREA)) tags.special_mgmt_area = safeStr(props.SPECIAL_MGMT_AREA);
        if (safeStr(props.MANAGING_ORG)) tags.managing_org = safeStr(props.MANAGING_ORG);

        const wilderness = classifyWilderness(path);
        if (wilderness) tags.wilderness_name = wilderness;

        const trail: TrailData = { id, name, path, tags };
        trails.push(trail);
        fetchedTrailIds.add(id);
        fetchedTrailIndex.set(id, trail);
      }

      if (page.features.length < PAGE_SIZE && !page.exceededTransferLimit) {
        hasMore = false;
      } else {
        offset += page.features.length;
      }
    }

    lastFetchMeta = {
      fetchedAt: new Date().toISOString(),
      region: 'USFS (live)',
      attribution: 'Trail data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Not for navigation.',
    };

    console.info(`[USFS API] fetched ${trails.length} trails for bbox [${south},${west},${north},${east}]`);
  } catch (err) {
    console.warn('[USFS API] fetch failed, continuing without official trails:', err);
  }

  return trails;
}

export function isOfficialTrail(trailId: number): boolean {
  return fetchedTrailIds.has(trailId);
}

export function getOfficialAttribution(trailId: number): string {
  const t = fetchedTrailIndex.get(trailId);
  if (!t) return '';
  const forest = t.tags.forest_name || 'USFS';
  return `Trail data: USDA Forest Service – ${forest}`;
}

export function getDataVintage(): { fetchedAt: string; forestName: string; attribution: string } {
  return {
    fetchedAt: lastFetchMeta.fetchedAt,
    forestName: lastFetchMeta.region,
    attribution: lastFetchMeta.attribution,
  };
}

export function getOfficialTrailCount(): number {
  return fetchedTrailIds.size;
}
