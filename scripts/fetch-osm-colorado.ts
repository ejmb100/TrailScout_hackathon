import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryOverpass } from '../server/overpassProxy';
import { buildOverpassRequestBody, normalizeOverpassResponse } from '../src/sources/osm';
import { SAN_JUAN_BBOX } from '../src/sources/usgs-ndt';
import type { IngestionOutput } from '../src/sources/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../data/ingestion');
const LABEL = 'san-juan';

function runId(): string {
  return process.env.INGESTION_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
}

async function main(): Promise<void> {
  const id = runId();
  const body = buildOverpassRequestBody(SAN_JUAN_BBOX);
  const result = await queryOverpass(body);
  if (result.status !== 200) {
    throw new Error(`Overpass proxy failed with HTTP ${result.status}: ${result.text.slice(0, 180)}`);
  }

  const raw = JSON.parse(result.text);
  const records = normalizeOverpassResponse(raw);
  const output: IngestionOutput = {
    meta: {
      runId: id,
      label: LABEL,
      sourceId: 'osm-overpass',
      sourceName: 'OpenStreetMap via Overpass',
      fetchedAt: new Date().toISOString(),
      bbox: SAN_JUAN_BBOX,
      endpoint: result.endpoint || 'Overpass mirror',
      featureCount: Array.isArray(raw.elements) ? raw.elements.length : 0,
      normalizedCount: records.length,
      validationIssueCount: records.reduce((sum, record) => sum + record.validationIssues.length, 0),
    },
    records,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, `run-${id}-${LABEL}-osm.json`);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[TrailScout ingestion] wrote ${records.length} OSM records to ${outputPath}`);
}

main().catch((error) => {
  console.error('[TrailScout ingestion] OSM fetch failed:', error);
  process.exitCode = 1;
});
