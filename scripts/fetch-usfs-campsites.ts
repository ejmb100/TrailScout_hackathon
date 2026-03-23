/**
 * ETL script: Fetch USFS recreation sites (campgrounds, camping areas, trailheads)
 * for San Juan National Forest from the EDW ArcGIS REST API.
 *
 * Run manually:  npx tsx scripts/fetch-usfs-campsites.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/data/usfs-san-juan-campsites.json');

const BASE_URL =
  'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0/query';

const PAGE_SIZE = 500;
const ADMIN_ORG_PREFIX = '0204';
const RELEVANT_SITE_TYPES = ['CAMPGROUND', 'CAMPING AREA', 'TRAILHEAD'];

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
}

interface OutputFile {
  meta: {
    fetchedAt: string;
    forestName: string;
    siteCount: number;
    attribution: string;
  };
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

async function fetchPage(offset: number): Promise<{ features: any[]; exceededTransferLimit: boolean }> {
  const where = `MANAGING_ORG LIKE '${ADMIN_ORG_PREFIX}%' AND SITE_TYPE IN (${RELEVANT_SITE_TYPES.map(t => `'${t}'`).join(',')})`;
  const params = new URLSearchParams({
    where,
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

  const url = `${BASE_URL}?${params}`;
  console.log(`  Fetching offset=${offset} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  }
  const data = await res.json();
  return {
    features: data.features ?? [],
    exceededTransferLimit: Boolean(data.exceededTransferLimit ?? data.properties?.exceededTransferLimit),
  };
}

async function main() {
  console.log(`\n=== USFS San Juan NF Campsite ETL ===\n`);

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

  const sites: CampsiteRecord[] = [];
  let skipped = 0;

  for (const f of allFeatures) {
    const a = f.attributes ?? {};
    const lat = Number(a.LATITUDE);
    const lng = Number(a.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      skipped++;
      continue;
    }

    const siteType = normSiteType(safeStr(a.SITE_TYPE));
    if (!siteType) {
      skipped++;
      continue;
    }

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

  const bySiteType = { campground: 0, camping_area: 0, trailhead: 0 };
  for (const s of sites) bySiteType[s.siteType]++;

  const output: OutputFile = {
    meta: {
      fetchedAt: new Date().toISOString(),
      forestName: 'San Juan National Forest',
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
