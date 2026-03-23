/**
 * ETL script: Fetch USFS recreation sites (campgrounds, camping areas, trailheads)
 * for all Colorado national forests from the EDW ArcGIS REST API.
 *
 * Run manually:  npx tsx scripts/fetch-usfs-campsites-colorado.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/data/usfs-colorado-campsites.json');

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0/query';

const PAGE_SIZE = 500;
const RELEVANT_SITE_TYPES = ['CAMPGROUND', 'CAMPING AREA', 'TRAILHEAD'];

/** Colorado national forests (same prefixes as trail ETL). */
const CO_ADMIN_ORG_PREFIXES = ['0203', '0204', '0205', '0206', '0207', '0208', '0210'];
const CO_BBOX = { south: 36.99, west: -109.06, north: 41.01, east: -102.04 };

export interface CampsiteRecord {
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
  forestName?: string;
}

interface OutputFile {
  meta: { fetchedAt: string; region: string; siteCount: number; attribution: string };
  sites: CampsiteRecord[];
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function normSiteType(raw: string): CampsiteRecord['siteType'] | null {
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

async function fetchPage(where: string, offset: number): Promise<{ features: any[]; exceededTransferLimit: boolean }> {
  const params = new URLSearchParams({
    where,
    outFields: [
      'OBJECTID', 'SITE_NAME', 'SITE_TYPE', 'ACTIVITY_TYPE_LIST',
      'FEE_CHARGED', 'WATER_AVAILABILITY', 'TOTAL_CAPACITY',
      'LATITUDE', 'LONGITUDE', 'PACK_IN_OUT', 'OPEN_SEASON',
      'PERMIT_INFORMATION', 'RESTRICTIONS', 'MANAGING_ORG',
    ].join(','),
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });
  const url = `${BASE_URL}?${params}`;
  console.log(`  Fetching offset=${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  const data = await res.json();
  return { features: data.features ?? [], exceededTransferLimit: Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit) };
}

async function main() {
  console.log(`\n=== USFS Colorado Campsite ETL ===\n`);

  const seenIds = new Set<number>();
  const allFeatures: any[] = [];
  const siteTypes = RELEVANT_SITE_TYPES.map(t => `'${t}'`).join(',');

  for (const prefix of CO_ADMIN_ORG_PREFIXES) {
    console.log(`\nFetching ${FOREST_NAMES[prefix] ?? prefix} ...`);
    const where = `MANAGING_ORG LIKE '${prefix}%' AND SITE_TYPE IN (${siteTypes})`;
    let offset = 0, hasMore = true;
    while (hasMore) {
      const page = await fetchPage(where, offset);
      for (const f of page.features) {
        const oid = f.attributes?.OBJECTID;
        if (oid != null && seenIds.has(oid)) continue;
        if (oid != null) seenIds.add(oid);
        allFeatures.push(f);
      }
      console.log(`    → ${page.features.length} features (total: ${allFeatures.length})`);
      if (page.features.length < PAGE_SIZE && !page.exceededTransferLimit) { hasMore = false; } else { offset += page.features.length; }
    }
  }

  // Bbox sweep
  console.log(`\nBbox sweep for Colorado ...`);
  const bboxWhere = `SITE_TYPE IN (${siteTypes})`;
  let bboxOffset = 0, bboxMore = true, bboxNew = 0;
  // For campsites we use a different approach — filter by geometry
  const bboxParams = new URLSearchParams({
    where: bboxWhere,
    geometry: `${CO_BBOX.west},${CO_BBOX.south},${CO_BBOX.east},${CO_BBOX.north}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: [
      'OBJECTID', 'SITE_NAME', 'SITE_TYPE', 'ACTIVITY_TYPE_LIST',
      'FEE_CHARGED', 'WATER_AVAILABILITY', 'TOTAL_CAPACITY',
      'LATITUDE', 'LONGITUDE', 'PACK_IN_OUT', 'OPEN_SEASON',
      'PERMIT_INFORMATION', 'RESTRICTIONS', 'MANAGING_ORG',
    ].join(','),
    f: 'json',
    resultOffset: '0',
    resultRecordCount: String(PAGE_SIZE),
  });

  while (bboxMore) {
    bboxParams.set('resultOffset', String(bboxOffset));
    const url = `${BASE_URL}?${bboxParams}`;
    console.log(`  [bbox] offset=${bboxOffset} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const features = data.features ?? [];
    for (const f of features) {
      const oid = f.attributes?.OBJECTID;
      if (oid != null && seenIds.has(oid)) continue;
      if (oid != null) seenIds.add(oid);
      allFeatures.push(f);
      bboxNew++;
    }
    console.log(`    → ${features.length} features (${bboxNew} new, total: ${allFeatures.length})`);
    if (features.length < PAGE_SIZE && !Boolean(data.exceededTransferLimit)) { bboxMore = false; } else { bboxOffset += features.length; }
  }

  console.log(`\nTotal raw features: ${allFeatures.length}`);

  const sites: CampsiteRecord[] = [];
  let skipped = 0;

  for (const f of allFeatures) {
    const a = f.attributes ?? {};
    const lat = Number(a.LATITUDE);
    const lng = Number(a.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) { skipped++; continue; }
    // Sanity: must be roughly in Colorado
    if (lat < 36 || lat > 42 || lng < -110 || lng > -101) { skipped++; continue; }

    const siteType = normSiteType(safeStr(a.SITE_TYPE));
    if (!siteType) { skipped++; continue; }

    const org = safeStr(a.MANAGING_ORG);

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
      forestName: forestNameFromOrg(org),
    });
  }

  const bySiteType = { campground: 0, camping_area: 0, trailhead: 0 };
  for (const s of sites) bySiteType[s.siteType]++;

  const output: OutputFile = {
    meta: {
      fetchedAt: new Date().toISOString(),
      region: 'Colorado',
      siteCount: sites.length,
      attribution:
        'Recreation site data sourced from USDA Forest Service, Enterprise Data Warehouse (EDW). Verify current availability at recreation.gov or fs.usda.gov.',
    },
    sites,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');

  console.log(`\n--- Results ---`);
  console.log(`  Total sites:    ${sites.length}`);
  console.log(`    Campgrounds:  ${bySiteType.campground}`);
  console.log(`    Camping areas:${bySiteType.camping_area}`);
  console.log(`    Trailheads:   ${bySiteType.trailhead}`);
  console.log(`  Skipped:        ${skipped}`);
  console.log(`  Written to:     ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
  console.error('ETL failed:', err);
  process.exit(1);
});
