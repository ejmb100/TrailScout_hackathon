/**
 * Service to interact with the OpenStreetMap Overpass API.
 * Responsible for fetching trail geometry and metadata.
 */

export interface TrailPoint {
  lat: number;
  lng: number;
}

export interface TrailData {
  id: number;
  name: string;
  path: TrailPoint[];
  tags: Record<string, string>;
  /** Total ascent from sampled path + DEM (meters). US: USGS 3DEP; else Open-Elevation when available. */
  elevationGainM?: number;
  /** Total descent from sampled path + DEM (meters). */
  elevationLossM?: number;
}

/** Prefer mirrors that are often less loaded than the main instance (see Overpass "too busy" HTML errors). */
const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const;

export interface FetchTrailsResult {
  trails: TrailData[];
  /** True when every endpoint failed or returned a non-JSON error page (e.g. server busy). */
  overpassUnavailable?: boolean;
  /** Overpass returned some OSM elements, even if none became usable TrailData rows. */
  hadRawOsmData?: boolean;
  /** Approximate number of OSM elements returned across requests. */
  rawElementCount?: number;
  /** Elements seen but filtered out during parsing. */
  filteredOutCount?: number;
  /** Some tiled requests succeeded before another tile failed. */
  partialResults?: boolean;
}

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function pointsClose(a: TrailPoint, b: TrailPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

const DEG_TO_RAD = Math.PI / 180;
const R_KM = 6371;

function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return R_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Max gap (km) between the endpoint of one segment and the start of the next
 * before we consider them disconnected. Segments beyond this threshold are
 * dropped to avoid drawing phantom straight lines across terrain.
 */
const MAX_SEGMENT_GAP_KM = 0.5;

/** Join OSM member ways in relation order; drop duplicate node at seams.
 *  Skips segments whose start is too far from the chain's current endpoint. */
function concatTrailSegments(segments: TrailPoint[][]): TrailPoint[] {
  if (segments.length === 0) return [];
  const out: TrailPoint[] = [...segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length === 0) continue;
    if (out.length && pointsClose(out[out.length - 1], seg[0])) {
      out.push(...seg.slice(1));
    } else if (out.length && haversineKm(out[out.length - 1], seg[0]) < MAX_SEGMENT_GAP_KM) {
      out.push(...seg);
    }
    // else: gap too large — skip this segment to avoid phantom lines
  }
  return out;
}

/**
 * Fetches hiking trails within a given bounding box.
 * Includes named path/footway/track ways and `route=hiking` relations (merged member ways).
 */
export async function fetchTrailsInBBox(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<FetchTrailsResult> {
  const query = `
    [out:json][timeout:45];
    (
      way["highway"~"path|footway|track"]["name"](${south},${west},${north},${east});
      way["highway"~"path|footway|track"]["ref"](${south},${west},${north},${east});
      way["highway"~"path|footway|track"]["sac_scale"](${south},${west},${north},${east});
      relation["route"="hiking"](${south},${west},${north},${east});
    );
    out body qt;
    >;
    out skel qt;
  `;

  const body = `data=${encodeURIComponent(query)}`;

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const url = OVERPASS_ENDPOINTS[i];
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed.startsWith('{')) {
        console.warn(
          `[OSM] Overpass non-JSON from ${url} (HTTP ${response.status}):`,
          trimmed.slice(0, 240)
        );
        continue;
      }
      const data = JSON.parse(trimmed) as unknown;
      const remark =
        typeof (data as any)?.remark === 'string'
          ? String((data as any).remark)
          : typeof (data as any)?.osm3s?.remark === 'string'
            ? String((data as any).osm3s.remark)
            : '';
      if (remark && /busy|timeout|quota|rate|dispatcher/i.test(remark)) {
        console.warn(`[OSM] Overpass JSON remark from ${url}:`, remark);
        continue;
      }
      const parsed = parseOverpassResponse(data);
      return {
        trails: parsed.trails,
        hadRawOsmData: parsed.hadRawOsmData,
        rawElementCount: parsed.rawElementCount,
        filteredOutCount: parsed.filteredOutCount,
      };
    } catch (error) {
      console.error(`[OSM] Overpass request failed (${url}):`, error);
    }
    if (i < OVERPASS_ENDPOINTS.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { trails: [], overpassUnavailable: true };
}

function bboxAreaDeg2({ south, west, north, east }: BBox): number {
  return Math.abs((north - south) * (east - west));
}

function splitBBox({ south, west, north, east }: BBox): BBox[] {
  const latSpan = north - south;
  const lonSpan = east - west;
  if (latSpan >= lonSpan) {
    const midLat = south + latSpan / 2;
    return [
      { south, west, north: midLat, east },
      { south: midLat, west, north, east },
    ];
  }

  const midLon = west + lonSpan / 2;
  return [
    { south, west, north, east: midLon },
    { south, west: midLon, north, east },
  ];
}

function buildWayTrailName(element: any): string | null {
  const tags = element?.tags || {};
  const name = String(tags.name || '').trim();
  if (name) return name;

  const ref = String(tags.ref || '').trim();
  if (ref) return ref;

  const sacScale = String(tags.sac_scale || '').trim();
  if (sacScale) {
    return `Trail segment (${sacScale.replaceAll('_', ' ')})`;
  }

  return null;
}

/**
 * Fetches trails, chunking large boxes into smaller requests to avoid Overpass "server busy" failures.
 */
export async function fetchTrailsWithFallback(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<FetchTrailsResult> {
  const queue: BBox[] = [{ south, west, north, east }];
  const merged = new Map<number, TrailData>();
  let anySuccess = false;
  let hadRawOsmData = false;
  let rawElementCount = 0;
  let filteredOutCount = 0;

  while (queue.length > 0) {
    const bbox = queue.shift()!;
    const result = await fetchTrailsInBBox(bbox.south, bbox.west, bbox.north, bbox.east);
    hadRawOsmData = hadRawOsmData || Boolean(result.hadRawOsmData);
    rawElementCount += result.rawElementCount || 0;
    filteredOutCount += result.filteredOutCount || 0;

    if (result.trails.length > 0) {
      anySuccess = true;
      for (const trail of result.trails) {
        merged.set(trail.id, trail);
      }
      continue;
    }

    if (
      !result.hadRawOsmData &&
      bboxAreaDeg2(bbox) > 0.18 &&
      queue.length < 12
    ) {
      queue.push(...splitBBox(bbox));
      continue;
    }

    if (
      result.overpassUnavailable &&
      bboxAreaDeg2(bbox) > 0.18 &&
      queue.length < 12
    ) {
      queue.push(...splitBBox(bbox));
      continue;
    }

    if (result.overpassUnavailable) {
      return anySuccess
        ? {
            trails: [...merged.values()],
            hadRawOsmData,
            rawElementCount,
            filteredOutCount,
            partialResults: true,
          }
        : {
            trails: [],
            overpassUnavailable: true,
            hadRawOsmData,
            rawElementCount,
            filteredOutCount,
          };
    }
  }

  return { trails: [...merged.values()], hadRawOsmData, rawElementCount, filteredOutCount };
}

/**
 * Parses Overpass JSON: nodes, ways, then `route=hiking` relations as merged polylines,
 * then named way segments not used by any relation.
 */
function parseOverpassResponse(data: any): {
  trails: TrailData[];
  hadRawOsmData: boolean;
  rawElementCount: number;
  filteredOutCount: number;
} {
  let filteredOutCount = 0;
  const nodes: Record<number, TrailPoint> = {};
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  for (const element of elements) {
    if (element.type === 'node') {
      nodes[element.id] = { lat: element.lat, lng: element.lon };
    }
  }

  const wayPaths = new Map<number, TrailPoint[]>();
  for (const element of elements) {
    if (element.type !== 'way') continue;
    const path: TrailPoint[] = (element.nodes || [])
      .map((nodeId: number) => nodes[nodeId])
      .filter(Boolean);
    if (path.length > 0) {
      wayPaths.set(element.id, path);
    } else {
      filteredOutCount++;
    }
  }

  const usedWayIds = new Set<number>();
  const trails: TrailData[] = [];

  for (const element of elements) {
    if (element.type !== 'relation') continue;
    if (element.tags?.route !== 'hiking') continue;

    const members = element.members || [];
    const segments: TrailPoint[][] = [];

    for (const m of members) {
      if (m.type !== 'way') continue;
      let seg = wayPaths.get(m.ref);
      if (!seg?.length) continue;
      seg = [...seg];
      const role = String(m.role || '').toLowerCase();
      if (role.includes('backward')) {
        seg.reverse();
      }
      segments.push(seg);
      usedWayIds.add(m.ref);
    }

    const path = concatTrailSegments(segments);
    if (path.length < 2) {
      filteredOutCount++;
      continue;
    }

    const name =
      element.tags?.name ||
      element.tags?.ref ||
      `Hiking route (${element.id})`;

    trails.push({
      id: -element.id,
      name,
      path,
      tags: {
        ...(element.tags || {}),
        trailscout_source: 'osm_relation',
      },
    });
  }

  for (const element of elements) {
    if (element.type !== 'way') continue;
    if (usedWayIds.has(element.id)) continue;
    const tags = element.tags || {};
    const hw = tags.highway;
    if (!hw || !/path|footway|track/.test(String(hw))) continue;

    const path = wayPaths.get(element.id);
    if (!path?.length) {
      filteredOutCount++;
      continue;
    }
    const trailName = buildWayTrailName(element);
    if (!trailName) {
      filteredOutCount++;
      continue;
    }

    trails.push({
      id: element.id,
      name: trailName,
      path,
      tags: {
        ...tags,
        trailscout_source: 'osm_way_segment',
      },
    });
  }

  return {
    trails,
    hadRawOsmData: elements.length > 0,
    rawElementCount: elements.length,
    filteredOutCount,
  };
}
