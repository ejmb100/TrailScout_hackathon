/**
 * ETL script: Fetch USFS trails for all Colorado national forests from the EDW
 * ArcGIS REST API, normalize to TrailData-shaped JSON, and write
 * src/data/usfs-colorado.json.
 *
 * Run manually:  npx tsx scripts/fetch-usfs-colorado.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/data/usfs-colorado.json');

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query';

const PAGE_SIZE = 1000;

/**
 * Colorado national forest ADMIN_ORG prefixes (USFS Region 02).
 * We exclude WY-only (0201 Bighorn, 0209 Shoshone), SD (0202 Black Hills),
 * and NE (0211 Nebraska, 0212 Thunder Basin).
 * 0203 Medicine Bow-Routt spans WY/CO — included for CO-side trails.
 */
const CO_ADMIN_ORG_PREFIXES = [
  '0203', // Medicine Bow-Routt NF (WY/CO)
  '0204', // San Juan NF
  '0205', // Grand Mesa / Uncompahgre / Gunnison NF
  '0206', // Pike-San Isabel NF
  '0207', // Arapaho-Roosevelt NF
  '0208', // Rio Grande NF
  '0210', // White River NF
];

/** Colorado bbox — used as a spatial filter to catch any trails with unexpected org codes. */
const CO_BBOX = { south: 36.99, west: -109.06, north: 41.01, east: -102.04 };

const ID_OFFSET = -900_000;

interface TrailPoint { lat: number; lng: number; }
interface TrailRecord { id: number; name: string; path: TrailPoint[]; tags: Record<string, string>; }
interface OutputFile {
  meta: { fetchedAt: string; region: string; featureCount: number; attribution: string; };
  trails: TrailRecord[];
}

/** Known Colorado wilderness areas (rough bbox centroids). */
const WILDERNESS_AREAS: { name: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { name: 'Weminuche Wilderness', minLat: 37.45, maxLat: 37.95, minLon: -107.75, maxLon: -107.05 },
  { name: 'Maroon Bells–Snowmass Wilderness', minLat: 38.95, maxLat: 39.25, minLon: -107.15, maxLon: -106.85 },
  { name: 'Flat Tops Wilderness', minLat: 39.75, maxLat: 40.15, minLon: -107.5, maxLon: -107.0 },
  { name: 'Eagles Nest Wilderness', minLat: 39.55, maxLat: 39.85, minLon: -106.3, maxLon: -106.0 },
  { name: 'Holy Cross Wilderness', minLat: 39.38, maxLat: 39.58, minLon: -106.55, maxLon: -106.25 },
  { name: 'Indian Peaks Wilderness', minLat: 39.95, maxLat: 40.15, minLon: -105.75, maxLon: -105.55 },
  { name: 'Mount Zirkel Wilderness', minLat: 40.55, maxLat: 40.85, minLon: -106.85, maxLon: -106.55 },
  { name: 'Rawah Wilderness', minLat: 40.6, maxLat: 40.8, minLon: -105.95, maxLon: -105.7 },
  { name: 'Collegiate Peaks Wilderness', minLat: 38.85, maxLat: 39.1, minLon: -106.5, maxLon: -106.2 },
  { name: 'Sangre de Cristo Wilderness', minLat: 37.8, maxLat: 38.15, minLon: -105.65, maxLon: -105.4 },
  { name: 'La Garita Wilderness', minLat: 37.8, maxLat: 38.1, minLon: -106.95, maxLon: -106.65 },
  { name: 'South San Juan Wilderness', minLat: 37.1, maxLat: 37.45, minLon: -106.8, maxLon: -106.4 },
  { name: 'Lizard Head Wilderness', minLat: 37.75, maxLat: 37.95, minLon: -108.0, maxLon: -107.75 },
  { name: 'Lost Creek Wilderness', minLat: 39.1, maxLat: 39.4, minLon: -105.6, maxLon: -105.25 },
  { name: 'Mount Evans Wilderness', minLat: 39.55, maxLat: 39.7, minLon: -105.65, maxLon: -105.5 },
  { name: 'Comanche Peak Wilderness', minLat: 40.45, maxLat: 40.65, minLon: -105.7, maxLon: -105.45 },
  { name: 'Never Summer Wilderness', minLat: 40.3, maxLat: 40.5, minLon: -105.9, maxLon: -105.7 },
  { name: 'Hunter-Fryingpan Wilderness', minLat: 39.1, maxLat: 39.35, minLon: -106.7, maxLon: -106.4 },
  { name: 'Raggeds Wilderness', minLat: 38.95, maxLat: 39.15, minLon: -107.35, maxLon: -107.1 },
  { name: 'West Elk Wilderness', minLat: 38.7, maxLat: 38.95, minLon: -107.3, maxLon: -106.95 },
  { name: 'Uncompahgre Wilderness', minLat: 38.0, maxLat: 38.15, minLon: -107.5, maxLon: -107.3 },
  { name: 'Powderhorn Wilderness', minLat: 38.25, maxLat: 38.4, minLon: -107.15, maxLon: -107.0 },
  { name: 'Mount Sneffels Wilderness', minLat: 38.0, maxLat: 38.1, minLon: -107.85, maxLon: -107.7 },
];

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

const MAX_POINTS_PER_SEGMENT = 150;
const MAX_POINTS_PER_STITCHED = 400;
const STITCH_GAP_KM = 1.5;

function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path: TrailPoint[]): number {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) d += haversineKm(path[i], path[i + 1]);
  return d;
}

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
      let bestIdx = -1, bestDist = STITCH_GAP_KM, bestEnd: 'head' | 'tail' = 'tail', bestReverse = false;

      for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;
        const seg = segments[i];
        const sStart = seg.path[0];
        const sEnd = seg.path[seg.path.length - 1];
        const d1 = haversineKm(tailPt, sStart);
        if (d1 < bestDist) { bestDist = d1; bestIdx = i; bestEnd = 'tail'; bestReverse = false; }
        const d2 = haversineKm(tailPt, sEnd);
        if (d2 < bestDist) { bestDist = d2; bestIdx = i; bestEnd = 'tail'; bestReverse = true; }
        const d3 = haversineKm(headPt, sEnd);
        if (d3 < bestDist) { bestDist = d3; bestIdx = i; bestEnd = 'head'; bestReverse = false; }
        const d4 = haversineKm(headPt, sStart);
        if (d4 < bestDist) { bestDist = d4; bestIdx = i; bestEnd = 'head'; bestReverse = true; }
      }

      if (bestIdx >= 0) {
        used.add(bestIdx);
        const seg = segments[bestIdx];
        const segPath = bestReverse ? [...seg.path].reverse() : seg.path;
        const attached: TrailRecord = { ...seg, path: segPath };
        if (bestEnd === 'tail') chain.push(attached); else chain.unshift(attached);
        extended = true;
      }
    }
    chains.push(chain);
  }

  const stitched: TrailRecord[] = [];
  for (const chain of chains) {
    if (chain.length === 1) { stitched.push(chain[0]); continue; }
    const combinedPath: TrailPoint[] = [];
    for (const seg of chain) combinedPath.push(...seg.path);
    stitched.push({
      id: chain[0].id,
      name: chain[0].name,
      path: combinedPath,
      tags: { ...chain[0].tags, trailscout_source: 'usfs_nfs_stitched', usfs_segment_count: String(chain.length) },
    });
  }
  return stitched;
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

/** Forest name by ADMIN_ORG prefix. */
const FOREST_NAMES: Record<string, string> = {
  '0203': 'Medicine Bow-Routt NF',
  '0204': 'San Juan NF',
  '0205': 'Grand Mesa/Uncompahgre/Gunnison NF',
  '0206': 'Pike-San Isabel NF',
  '0207': 'Arapaho-Roosevelt NF',
  '0208': 'Rio Grande NF',
  '0210': 'White River NF',
};

function forestNameFromOrg(org: string): string {
  for (const [prefix, name] of Object.entries(FOREST_NAMES)) {
    if (org.startsWith(prefix)) return name;
  }
  return 'Colorado NF';
}

async function fetchPageByOrg(prefix: string, offset: number): Promise<{ features: any[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where: `ADMIN_ORG LIKE '${prefix}%'`,
    outFields: '*',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });
  const url = `${BASE_URL}?${params}`;
  console.log(`  [${prefix}] offset=${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  const data = await res.json();
  return { features: data.features ?? [], exceededTransferLimit: Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit) };
}

async function fetchPageByBBox(offset: number): Promise<{ features: any[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    geometry: `${CO_BBOX.west},${CO_BBOX.south},${CO_BBOX.east},${CO_BBOX.north}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: '*',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });
  const url = `${BASE_URL}?${params}`;
  console.log(`  [bbox] offset=${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  const data = await res.json();
  return { features: data.features ?? [], exceededTransferLimit: Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit) };
}

async function main() {
  console.log(`\n=== USFS Colorado Trail ETL ===\n`);

  // Strategy: fetch by ADMIN_ORG prefix for known forests, then also fetch by
  // bbox to pick up any trails with unexpected org codes. Deduplicate by OBJECTID.
  const seenIds = new Set<number>();
  const allFeatures: any[] = [];

  for (const prefix of CO_ADMIN_ORG_PREFIXES) {
    console.log(`\nFetching forest ${FOREST_NAMES[prefix] ?? prefix} ...`);
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await fetchPageByOrg(prefix, offset);
      for (const f of page.features) {
        const oid = f.properties?.OBJECTID ?? f.properties?.FID;
        if (oid != null && seenIds.has(oid)) continue;
        if (oid != null) seenIds.add(oid);
        allFeatures.push(f);
      }
      console.log(`    → ${page.features.length} features (total so far: ${allFeatures.length})`);
      if (page.features.length < PAGE_SIZE && !page.exceededTransferLimit) { hasMore = false; } else { offset += page.features.length; }
    }
  }

  // Bbox sweep for stragglers
  console.log(`\nBbox sweep for Colorado ...`);
  let bboxOffset = 0;
  let bboxMore = true;
  let bboxNew = 0;
  while (bboxMore) {
    const page = await fetchPageByBBox(bboxOffset);
    for (const f of page.features) {
      const oid = f.properties?.OBJECTID ?? f.properties?.FID;
      if (oid != null && seenIds.has(oid)) continue;
      if (oid != null) seenIds.add(oid);
      allFeatures.push(f);
      bboxNew++;
    }
    console.log(`    → ${page.features.length} features (${bboxNew} new, total: ${allFeatures.length})`);
    if (page.features.length < PAGE_SIZE && !page.exceededTransferLimit) { bboxMore = false; } else { bboxOffset += page.features.length; }
  }

  console.log(`\nTotal raw features: ${allFeatures.length}`);

  const trails: TrailRecord[] = [];
  let skippedNoGeom = 0, skippedShort = 0, totalPoints = 0;

  for (const f of allFeatures) {
    const geom = f.geometry;
    if (!geom || !geom.coordinates) { skippedNoGeom++; continue; }
    const rawPath = coordsToPath(geom.coordinates);
    if (rawPath.length < 2) { skippedShort++; continue; }

    const props = f.properties ?? {};
    const objectId = Number(props.OBJECTID ?? props.FID ?? trails.length);
    const id = ID_OFFSET - objectId;
    const path = samplePath(rawPath, MAX_POINTS_PER_SEGMENT).map(compactPoint);
    const name = safeStr(props.TRAIL_NAME) || safeStr(props.TRAIL_NO) || `USFS Trail ${objectId}`;
    const org = safeStr(props.ADMIN_ORG) || safeStr(props.MANAGING_ORG);

    const tags: Record<string, string> = {
      trailscout_source: 'usfs_nfs',
      forest_name: forestNameFromOrg(org),
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
      t.tags.trailscout_length_km = pathLengthKm(sampled).toFixed(1);
      t.path = sampled;
      finalTrails.push(t);
    }
    if (result.length < group.length) stitchedGroupCount++;
  }

  const stitchedCount = finalTrails.filter(t => t.tags.trailscout_source === 'usfs_nfs_stitched').length;
  console.log(`  Unique trail names:            ${byName.size}`);
  console.log(`  Groups that were stitched:     ${stitchedGroupCount}`);
  console.log(`  Stitched composite trails:     ${stitchedCount}`);
  console.log(`  Remaining single segments:     ${finalTrails.length - stitchedCount}`);
  console.log(`  Total output trails:           ${finalTrails.length}`);

  const longTrails = finalTrails
    .map(t => ({ name: t.name, km: parseFloat(t.tags.trailscout_length_km), segs: t.tags.usfs_segment_count ?? '1', forest: t.tags.forest_name }))
    .sort((a, b) => b.km - a.km)
    .slice(0, 20);
  console.log(`\n  Top 20 trails by length:`);
  for (const t of longTrails) {
    console.log(`    ${t.km.toFixed(1).padStart(7)} km  (${t.segs} seg)  ${t.name} [${t.forest}]`);
  }

  // Forest breakdown
  const forestCounts = new Map<string, number>();
  for (const t of finalTrails) {
    const f = t.tags.forest_name || 'Unknown';
    forestCounts.set(f, (forestCounts.get(f) ?? 0) + 1);
  }
  console.log(`\n  Trails by forest:`);
  for (const [f, c] of [...forestCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(c).padStart(5)}  ${f}`);
  }

  let totalPointsFinal = 0;
  for (const t of finalTrails) totalPointsFinal += t.path.length;

  const output: OutputFile = {
    meta: {
      fetchedAt: new Date().toISOString(),
      region: 'Colorado',
      featureCount: finalTrails.length,
      attribution:
        'Trail data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Not for navigation. Verify current conditions at fs.usda.gov.',
    },
    trails: finalTrails,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');

  const fileSizeBytes = Buffer.byteLength(JSON.stringify(output));
  console.log(`\n--- Results ---`);
  console.log(`  Trails written:  ${finalTrails.length}`);
  console.log(`  Total points:    ${totalPointsFinal}`);
  console.log(`  Skipped (no geom): ${skippedNoGeom}`);
  console.log(`  Skipped (< 2 pts): ${skippedShort}`);
  console.log(`  File size:       ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Written to:      ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
  console.error('ETL failed:', err);
  process.exit(1);
});
