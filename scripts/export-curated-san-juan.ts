import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { representativePoint, distanceMeters } from '../src/lib/geo';
import type { IngestionTrailRecord, MergedIngestionOutput } from '../src/sources/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INGESTION_DIR = resolve(__dirname, '../data/ingestion');
const LABEL = 'san-juan-curated';
const DEFAULT_LIMIT = 250;
const NEAR_RADIUS_M = 25_000;

const FOCUS_POINTS = [
  { name: 'Silverton', lat: 37.8119, lng: -107.6645 },
  { name: 'Ouray', lat: 38.0228, lng: -107.6714 },
  { name: 'Telluride', lat: 37.9375, lng: -107.8123 },
  { name: 'Durango', lat: 37.2753, lng: -107.8801 },
  { name: 'Weminuche', lat: 37.72, lng: -107.35 },
  { name: 'Ice Lakes', lat: 37.8177, lng: -107.7685 },
];

const NAME_TERMS = [
  'silverton',
  'ouray',
  'telluride',
  'durango',
  'weminuche',
  'ice lake',
  'ice lakes',
  'colorado trail',
  'highline',
];

const MANAGER_TERMS = ['FS', 'BLM', 'NPS'];

function latestMergedPath(): string {
  const explicit = process.env.INGESTION_MERGED_PATH;
  if (explicit) return resolve(explicit);

  const candidates = existsSync(INGESTION_DIR)
    ? readdirSync(INGESTION_DIR)
        .filter((name) => /-san-juan-merged\.json$/.test(name))
        .sort()
    : [];

  const latest = candidates.at(-1);
  if (!latest) {
    throw new Error(`No San Juan merged ingestion file found in ${INGESTION_DIR}. Run scripts/run-ingestion.ts first.`);
  }
  return resolve(INGESTION_DIR, latest);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function recordText(record: IngestionTrailRecord): string {
  return normalizeText([
    record.name,
    record.canonicalName,
    ...record.alternateNames,
    record.landManager || '',
    record.managingAgency || '',
  ].join(' '));
}

function hasUsefulSource(record: IngestionTrailRecord): boolean {
  return record.sourceIds.includes('usgs-tnm-trails') || record.sourceIds.includes('osm-overpass');
}

function hasValidGeometry(record: IngestionTrailRecord): boolean {
  return record.geometry.length >= 2 && !record.validationIssues.some((issue) => /empty geometry|fewer than 2/i.test(issue));
}

function matchReason(record: IngestionTrailRecord): string | null {
  const text = recordText(record);
  const term = NAME_TERMS.find((candidate) => text.includes(candidate));
  if (term) return `name term: ${term}`;

  const manager = MANAGER_TERMS.find((candidate) => text.includes(candidate.toLowerCase()));
  if (manager && (record.lengthMiles || 0) >= 2) return `manager/length context: ${manager}`;

  const point = representativePoint(record.geometry);
  if (!point || (record.lengthMiles || 0) < 2) return null;
  const focus = FOCUS_POINTS.find((focusPoint) => distanceMeters(focusPoint, point) <= NEAR_RADIUS_M);
  if (focus) return `within ${Math.round(NEAR_RADIUS_M / 1000)}km of ${focus.name}`;

  return null;
}

function scoreRecord(record: IngestionTrailRecord, reason: string): number {
  const sourceBoost = record.sourceIds.includes('usgs-tnm-trails') ? 20 : 0;
  const linkedBoost = record.sourceIds.includes('osm-overpass') ? 10 : 0;
  const nameBoost = reason.startsWith('name term') ? 15 : 0;
  const lengthBoost = Math.min(record.lengthMiles || 0, 20);
  return record.confidence + sourceBoost + linkedBoost + nameBoost + lengthBoost;
}

function runId(): string {
  return process.env.INGESTION_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
}

function main(): void {
  const sourcePath = latestMergedPath();
  const limit = Number(process.env.CURATED_LIMIT || DEFAULT_LIMIT);
  const merged = JSON.parse(readFileSync(sourcePath, 'utf8')) as MergedIngestionOutput;
  const candidates = merged.records
    .filter((record) => hasUsefulSource(record) && hasValidGeometry(record))
    .map((record) => ({ record, reason: matchReason(record) }))
    .filter((item): item is { record: IngestionTrailRecord; reason: string } => item.reason != null)
    .sort((a, b) => scoreRecord(b.record, b.reason) - scoreRecord(a.record, a.reason))
    .slice(0, limit)
    .map(({ record, reason }) => ({
      ...record,
      validationIssues: [...record.validationIssues, `curated subset match: ${reason}`],
    }));

  const id = runId();
  const output: MergedIngestionOutput = {
    ...merged,
    meta: {
      ...merged.meta,
      runId: id,
      label: LABEL,
      sourceId: 'curated-san-juan-baseline',
      sourceName: 'Curated San Juan Local Baseline',
      normalizedCount: candidates.length,
      validationIssueCount: candidates.reduce((sum, record) => sum + record.validationIssues.length, 0),
    },
    records: candidates,
    duplicateCandidates: merged.duplicateCandidates.filter((candidate) =>
      candidates.some((record) => record.id === candidate.primaryId || record.id === candidate.duplicateId),
    ),
  };

  mkdirSync(INGESTION_DIR, { recursive: true });
  const outPath = resolve(INGESTION_DIR, `run-${id}-${LABEL}.json`);
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[TrailScout ingestion] wrote ${candidates.length} curated records to ${outPath}`);
}

main();
