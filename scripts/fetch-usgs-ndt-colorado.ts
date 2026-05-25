import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TNM_TRANSPORTATION_MAPSERVER, fetchUsgsNdtTrails, SAN_JUAN_BBOX } from '../src/sources/usgs-ndt';
import type { IngestionOutput } from '../src/sources/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../data/ingestion');
const LABEL = 'san-juan';

function runId(): string {
  return process.env.INGESTION_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
}

async function main(): Promise<void> {
  const id = runId();
  const endpoint = process.env.TNM_TRANSPORTATION_MAPSERVER_URL || DEFAULT_TNM_TRANSPORTATION_MAPSERVER;
  const { records } = await fetchUsgsNdtTrails(SAN_JUAN_BBOX, endpoint);
  const output: IngestionOutput = {
    meta: {
      runId: id,
      label: LABEL,
      sourceId: 'usgs-tnm-trails',
      sourceName: 'USGS The National Map Transportation Trails',
      fetchedAt: new Date().toISOString(),
      bbox: SAN_JUAN_BBOX,
      endpoint: `${endpoint.replace(/\/$/, '')}/37`,
      featureCount: records.length,
      normalizedCount: records.length,
      validationIssueCount: records.reduce((sum, record) => sum + record.validationIssues.length, 0),
    },
    records,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, `run-${id}-${LABEL}-usgs-ndt.json`);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[TrailScout ingestion] wrote ${records.length} USGS/TNM records to ${outputPath}`);
}

main().catch((error) => {
  console.error('[TrailScout ingestion] USGS/TNM fetch failed:', error);
  process.exitCode = 1;
});
