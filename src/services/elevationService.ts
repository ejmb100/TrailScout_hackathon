/**
 * Trail elevation: USGS 3DEP (National Map ImageServer getSamples) inside the US,
 * Open-Elevation elsewhere or when 3DEP fails.
 *
 * Dev: Vite proxies /api/3dep and /api/elevation for CORS.
 */

import type { TrailData, TrailPoint } from './osmService';

const MAX_SAMPLES_PER_TRAIL = 48;

const DEP_3_SAMPLES_PATH =
  '/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';

function openElevationLookupUrl(): string {
  if (import.meta.env.DEV) {
    return '/api/elevation/lookup';
  }
  return 'https://api.open-elevation.com/api/v1/lookup';
}

function threeDepGetSamplesUrl(): string {
  if (import.meta.env.DEV) {
    return '/api/3dep/getSamples';
  }
  return `https://elevation.nationalmap.gov${DEP_3_SAMPLES_PATH}`;
}

/** Centroid of path for region checks. */
function trailCentroid(path: TrailPoint[]): TrailPoint {
  let lat = 0;
  let lng = 0;
  for (const p of path) {
    lat += p.lat;
    lng += p.lng;
  }
  const n = path.length;
  return { lat: lat / n, lng: lng / n };
}

/**
 * Rough US coverage for 3DEP dynamic service (CONUS + Alaska + Hawaii).
 */
export function isLikelyUnitedStates(lat: number, lng: number): boolean {
  // CONUS + adjacent
  if (lat >= 24.0 && lat <= 50.0 && lng >= -125.0 && lng <= -65.0) return true;
  // Alaska (approximate)
  if (lat >= 51.0 && lat <= 72.0 && lng >= -170.0 && lng <= -129.0) return true;
  // Hawaii
  if (lat >= 18.5 && lat <= 22.5 && lng >= -161.0 && lng <= -154.5) return true;
  return false;
}

/** Evenly sample vertices along the path (always includes first and last). */
export function samplePathPoints(path: TrailPoint[], maxPoints: number): TrailPoint[] {
  if (path.length <= maxPoints) return path.slice();
  const out: TrailPoint[] = [];
  const n = maxPoints;
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (path.length - 1));
    out.push(path[idx]);
  }
  return out;
}

export function elevationGainLossM(elevations: number[]): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  for (let i = 0; i < elevations.length - 1; i++) {
    const a = elevations[i];
    const b = elevations[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = b - a;
    if (d > 0) gainM += d;
    else lossM += -d;
  }
  return { gainM: Math.round(gainM), lossM: Math.round(lossM) };
}

function parse3DepSampleValue(value: string): number | null {
  if (value == null || value === '') return null;
  const lower = value.toLowerCase();
  if (lower.includes('nodata') || lower === 'nan') return null;
  const first = value.split(',')[0].trim();
  const n = parseFloat(first);
  return Number.isFinite(n) ? n : null;
}

/**
 * USGS 3D Elevation Program dynamic ImageServer — multipoint getSamples (meters, ellipsoid per service).
 */
async function fetchElevations3Dep(points: TrailPoint[]): Promise<number[] | null> {
  if (points.length < 2) return null;

  const geometry = {
    points: points.map((p) => [p.lng, p.lat] as [number, number]),
    spatialReference: { wkid: 4326 },
  };

  const body = new URLSearchParams();
  body.set('f', 'json');
  body.set('geometryType', 'esriGeometryMultipoint');
  body.set('geometry', JSON.stringify(geometry));
  body.set('interpolation', 'RSP_BilinearInterpolation');
  body.set('returnFirstValueOnly', 'true');

  try {
    const res = await fetch(threeDepGetSamplesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      samples?: { value: string; locationId?: number }[];
      error?: { message?: string };
    };
    if (data.error?.message) return null;
    const samples = data.samples;
    if (!samples || samples.length !== points.length) return null;

    const elevations: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const v = parse3DepSampleValue(samples[i].value);
      if (v == null) return null;
      elevations.push(v);
    }
    return elevations;
  } catch {
    return null;
  }
}

async function fetchElevationsOpenElevation(points: TrailPoint[]): Promise<number[] | null> {
  if (points.length < 2) return null;

  const locations = points.map((p) => ({ latitude: p.lat, longitude: p.lng }));

  try {
    const res = await fetch(openElevationLookupUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { elevation: number }[] };
    const results = data.results;
    if (!results || results.length !== locations.length) return null;
    return results.map((r) => r.elevation);
  } catch {
    return null;
  }
}

async function fetchElevationsForSamples(points: TrailPoint[]): Promise<number[] | null> {
  const c = trailCentroid(points);
  const tryUsgs = isLikelyUnitedStates(c.lat, c.lng);

  if (tryUsgs) {
    const usgs = await fetchElevations3Dep(points);
    if (usgs) return usgs;
  }

  return fetchElevationsOpenElevation(points);
}

async function enrichSingleTrail(trail: TrailData): Promise<TrailData> {
  if (trail.path.length < 2) {
    return trail;
  }

  const sampled = samplePathPoints(trail.path, MAX_SAMPLES_PER_TRAIL);
  const elevations = await fetchElevationsForSamples(sampled);

  if (!elevations) {
    return { ...trail };
  }

  const { gainM, lossM } = elevationGainLossM(elevations);
  return {
    ...trail,
    elevationGainM: gainM,
    elevationLossM: lossM,
  };
}

/** Adds elevationGainM / elevationLossM to each trail (best-effort; skips on API failure). */
export async function enrichTrailsWithElevation(
  trails: TrailData[],
  options?: { maxTrails?: number; concurrency?: number }
): Promise<TrailData[]> {
  const selected = trails.slice(0, options?.maxTrails ?? trails.length);
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, selected.length || 1));
  const out = new Array<TrailData>(selected.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= selected.length) return;
      out[currentIndex] = await enrichSingleTrail(selected[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}
