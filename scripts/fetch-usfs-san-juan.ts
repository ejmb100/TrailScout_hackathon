/**
 * ETL script: Fetch USFS San Juan National Forest trails from the EDW ArcGIS REST API,
 * normalize to TrailData-shaped JSON, and write src/data/usfs-san-juan.json.
 *
 * Run manually:  npx tsx scripts/fetch-usfs-san-juan.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/data/usfs-san-juan.json');

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query';

const PAGE_SIZE = 1000;
const FOREST_NAME = 'San Juan National Forest';
/** USFS org codes for San Juan NF ranger districts (prefix 0204). */
const ADMIN_ORG_PREFIX = '0204';
const ID_OFFSET = -900_000;

/** Weminuche Wilderness rough bbox for tagging (does not replace authoritative boundary). */
const WEMINUCHE_BBOX = {
  minLat: 37.45,
  maxLat: 37.95,
  minLon: -107.75,
  maxLon: -107.05,
};

interface TrailPoint {
  lat: number;
  lng: number;
}

interface TrailRecord {
  id: number;
  name: string;
  path: TrailPoint[];
  tags: Record<string, string>;
}

interface OutputFile {
  meta: {
    fetchedAt: string;
    forestName: string;
    featureCount: number;
    attribution: string;
  };
  trails: TrailRecord[];
}

function isInsideWeminucheBBox(lat: number, lng: number): boolean {
  return (
    lat >= WEMINUCHE_BBOX.minLat &&
    lat <= WEMINUCHE_BBOX.maxLat &&
    lng >= WEMINUCHE_BBOX.minLon &&
    lng <= WEMINUCHE_BBOX.maxLon
  );
}

/** Downsample a polyline to at most maxPts points, keeping first and last. */
function samplePath(path: TrailPoint[], maxPts: number): TrailPoint[] {
  if (path.length <= maxPts) return path;
  const step = (path.length - 1) / (maxPts - 1);
  const out: TrailPoint[] = [];
  for (let i = 0; i < maxPts - 1; i++) {
    out.push(path[Math.round(i * step)]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Round lat/lng to 5 decimal places (~1 m precision). */
function compactPoint(p: TrailPoint): TrailPoint {
  return { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 };
}

const MAX_POINTS_PER_SEGMENT = 80;
const MAX_POINTS_PER_STITCHED = 200;
/** Max gap (km) between segment endpoints to consider them connectable. */
const STITCH_GAP_KM = 1.5;

function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path: TrailPoint[]): number {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) d += haversineKm(path[i], path[i + 1]);
  return d;
}

/**
 * Stitch same-name segments into composite trails by chaining endpoints.
 * Uses a greedy nearest-endpoint approach: pick an unvisited segment,
 * then repeatedly attach the closest unvisited segment whose endpoint
 * is within STITCH_GAP_KM of the current chain's head or tail.
 */
function stitchSegments(segments: TrailRecord[]): TrailRecord[] {
  if (segments.length <= 1) return segments;

  const used = new Set<number>();
  const chains: TrailRecord[][] = [];

  while (used.size < segments.length) {
    const seedIdx = segments.findIndex((_, i) => !used.has(i));
    if (seedIdx < 0) break;
    used.add(seedIdx);
    const chain = [segments[seedIdx]];

    let extended = true;
    while (extended) {
      extended = false;
      const headPt = chain[0].path[0];
      const tailPt = chain[chain.length - 1].path[chain[chain.length - 1].path.length - 1];

      let bestIdx = -1;
      let bestDist = STITCH_GAP_KM;
      let bestEnd: 'head' | 'tail' = 'tail';
      let bestReverse = false;

      for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;
        const seg = segments[i];
        const sStart = seg.path[0];
        const sEnd = seg.path[seg.path.length - 1];

        // try attaching seg's start to chain tail
        const d1 = haversineKm(tailPt, sStart);
        if (d1 < bestDist) { bestDist = d1; bestIdx = i; bestEnd = 'tail'; bestReverse = false; }
        // try attaching seg's end to chain tail (reversed)
        const d2 = haversineKm(tailPt, sEnd);
        if (d2 < bestDist) { bestDist = d2; bestIdx = i; bestEnd = 'tail'; bestReverse = true; }
        // try attaching seg's end to chain head
        const d3 = haversineKm(headPt, sEnd);
        if (d3 < bestDist) { bestDist = d3; bestIdx = i; bestEnd = 'head'; bestReverse = false; }
        // try attaching seg's start to chain head (reversed)
        const d4 = haversineKm(headPt, sStart);
        if (d4 < bestDist) { bestDist = d4; bestIdx = i; bestEnd = 'head'; bestReverse = true; }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx);
        const seg = segments[bestIdx];
        const segPath = bestReverse ? [...seg.path].reverse() : seg.path;
        const attached: TrailRecord = { ...seg, path: segPath };
        if (bestEnd === 'tail') {
          chain.push(attached);
        } else {
          chain.unshift(attached);
        }
        extended = true;
      }
    }

    chains.push(chain);
  }

  const stitched: TrailRecord[] = [];
  for (const chain of chains) {
    if (chain.length === 1) {
      stitched.push(chain[0]);
      continue;
    }
    const combinedPath: TrailPoint[] = [];
    for (const seg of chain) {
      combinedPath.push(...seg.path);
    }
    const baseSeg = chain[0];
    stitched.push({
      id: baseSeg.id,
      name: baseSeg.name,
      path: combinedPath,
      tags: {
        ...baseSeg.tags,
        trailscout_source: 'usfs_nfs_stitched',
        usfs_segment_count: String(chain.length),
      },
    });
  }

  return stitched;
}

function classifyWilderness(path: TrailPoint[]): string | undefined {
  if (path.length === 0) return undefined;
  const mid = path[Math.floor(path.length / 2)];
  if (isInsideWeminucheBBox(mid.lat, mid.lng)) return 'Weminuche Wilderness';
  return undefined;
}

function coordsToPath(coords: number[][] | number[][][]): TrailPoint[] {
  const flat: number[][] = Array.isArray(coords[0]?.[0]) ? (coords as number[][][]).flat() : (coords as number[][]);
  return flat
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => ({ lat: c[1], lng: c[0] }));
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

async function fetchPage(offset: number): Promise<{ features: any[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where: `ADMIN_ORG LIKE '${ADMIN_ORG_PREFIX}%'`,
    outFields: '*',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  const url = `${BASE_URL}?${params}`;
  console.log(`  Fetching offset=${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  }
  const data = await res.json();
  const features: any[] = data.features ?? [];
  const exceededTransferLimit: boolean = Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit);
  return { features, exceededTransferLimit };
}

async function main() {
  console.log(`\n=== USFS San Juan NF Trail ETL ===\n`);

  const allFeatures: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await fetchPage(offset);
    allFeatures.push(...page.features);
    console.log(`    → got ${page.features.length} features (total so far: ${allFeatures.length})`);
    if (page.features.length < PAGE_SIZE && !page.exceededTransferLimit) {
      hasMore = false;
    } else {
      offset += page.features.length;
    }
  }

  console.log(`\nTotal raw features: ${allFeatures.length}`);

  const trails: TrailRecord[] = [];
  let skippedNoGeom = 0;
  let skippedShort = 0;
  let totalPoints = 0;
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;

  for (const f of allFeatures) {
    const geom = f.geometry;
    if (!geom || !geom.coordinates) {
      skippedNoGeom++;
      continue;
    }

    const rawPath = coordsToPath(geom.coordinates);
    if (rawPath.length < 2) {
      skippedShort++;
      continue;
    }

    const props = f.properties ?? {};
    const objectId = Number(props.OBJECTID ?? props.FID ?? trails.length);
    const id = ID_OFFSET - objectId;

    const path = samplePath(rawPath, MAX_POINTS_PER_SEGMENT).map(compactPoint);

    const name = safeStr(props.TRAIL_NAME) || safeStr(props.TRAIL_NO) || `USFS Trail ${objectId}`;

    const tags: Record<string, string> = {
      trailscout_source: 'usfs_nfs',
      forest_name: FOREST_NAME,
    };
    if (safeStr(props.TRAIL_NO)) tags.usfs_trail_no = safeStr(props.TRAIL_NO);
    if (safeStr(props.TRAIL_TYPE)) tags.trail_type = safeStr(props.TRAIL_TYPE);
    if (safeStr(props.TRAIL_CLASS)) tags.trail_class = safeStr(props.TRAIL_CLASS);
    if (safeStr(props.MANAGED_USE)) tags.managed_use = safeStr(props.MANAGED_USE);
    if (safeStr(props.SURFACE_TYPE)) tags.surface_type = safeStr(props.SURFACE_TYPE);
    if (safeStr(props.SPECIAL_MGMT_AREA)) tags.special_mgmt_area = safeStr(props.SPECIAL_MGMT_AREA);
    if (safeStr(props.MANAGING_ORG)) tags.managing_org = safeStr(props.MANAGING_ORG);
    if (safeStr(props.ACCESSIBILITY_STATUS)) tags.accessibility_status = safeStr(props.ACCESSIBILITY_STATUS);

    const wilderness = classifyWilderness(path);
    if (wilderness) tags.wilderness_name = wilderness;

    trails.push({ id, name, path, tags });
    totalPoints += path.length;

    for (const p of path) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
  }

  // --- Segment stitching ---
  console.log(`\n--- Stitching segments by trail name ---`);

  const byName = new Map<string, TrailRecord[]>();
  for (const t of trails) {
    const key = t.name.toUpperCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(t);
  }

  const finalTrails: TrailRecord[] = [];
  let stitchedGroupCount = 0;

  for (const [, group] of byName) {
    const result = stitchSegments(group);
    for (const t of result) {
      const sampled = samplePath(t.path, MAX_POINTS_PER_STITCHED).map(compactPoint);
      const wilderness = classifyWilderness(sampled);
      if (wilderness && !t.tags.wilderness_name) t.tags.wilderness_name = wilderness;
      const lengthKm = pathLengthKm(sampled);
      t.tags.trailscout_length_km = lengthKm.toFixed(1);
      t.path = sampled;
      finalTrails.push(t);
    }
    if (result.length < group.length) stitchedGroupCount++;
  }

  const stitchedCount = finalTrails.filter(t => t.tags.trailscout_source === 'usfs_nfs_stitched').length;
  console.log(`  Groups with multiple segments: ${byName.size - [...byName.values()].filter(g => g.length === 1).length}`);
  console.log(`  Groups that were stitched:     ${stitchedGroupCount}`);
  console.log(`  Stitched composite trails:     ${stitchedCount}`);
  console.log(`  Remaining single segments:     ${finalTrails.length - stitchedCount}`);
  console.log(`  Total output trails:           ${finalTrails.length}`);

  const longTrails = finalTrails
    .map(t => ({ name: t.name, km: parseFloat(t.tags.trailscout_length_km), segs: t.tags.usfs_segment_count ?? '1' }))
    .sort((a, b) => b.km - a.km)
    .slice(0, 15);
  console.log(`\n  Top 15 trails by length:`);
  for (const t of longTrails) {
    console.log(`    ${t.km.toFixed(1).padStart(7)} km  (${t.segs} seg)  ${t.name}`);
  }

  let totalPointsFinal = 0;
  for (const t of finalTrails) totalPointsFinal += t.path.length;

  const output: OutputFile = {
    meta: {
      fetchedAt: new Date().toISOString(),
      forestName: FOREST_NAME,
      featureCount: finalTrails.length,
      attribution:
        'Trail data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Not for navigation. Verify current conditions at fs.usda.gov.',
    },
    trails: finalTrails,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');

  console.log(`\n--- Results ---`);
  console.log(`  Trails written : ${finalTrails.length}`);
  console.log(`  Total points   : ${totalPointsFinal}`);
  console.log(`  Skipped (no geometry): ${skippedNoGeom}`);
  console.log(`  Skipped (< 2 pts)   : ${skippedShort}`);
  if (finalTrails.length > 0) {
    console.log(`  Bounding extent: lat [${minLat.toFixed(4)}, ${maxLat.toFixed(4)}], lng [${minLng.toFixed(4)}, ${maxLng.toFixed(4)}]`);
  }
  console.log(`  Written to: ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
  console.error('ETL failed:', err);
  process.exit(1);
});
