import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryOverpass } from '../server/overpassProxy';
import { mergeWithDuplicateLinks } from '../src/sources/dedupe';
import { buildOverpassRequestBody, normalizeOverpassResponse } from '../src/sources/osm';
import { DEFAULT_TNM_TRANSPORTATION_MAPSERVER, fetchUsgsNdtTrails, SAN_JUAN_BBOX } from '../src/sources/usgs-ndt';
import type { IngestionOutput, IngestionTrailRecord, MergedIngestionOutput } from '../src/sources/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../data/ingestion');
const LABEL = 'san-juan';

function runId(): string {
  return process.env.INGESTION_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
}

function validationIssueCount(records: IngestionTrailRecord[]): number {
  return records.reduce((sum, record) => sum + record.validationIssues.length, 0);
}

function ingestionOutput(
  runIdValue: string,
  sourceId: string,
  sourceName: string,
  endpoint: string,
  featureCount: number,
  records: IngestionTrailRecord[],
): IngestionOutput {
  return {
    meta: {
      runId: runIdValue,
      label: LABEL,
      sourceId,
      sourceName,
      fetchedAt: new Date().toISOString(),
      bbox: SAN_JUAN_BBOX,
      endpoint,
      featureCount,
      normalizedCount: records.length,
      validationIssueCount: validationIssueCount(records),
    },
    records,
  };
}

function reportMarkdown(usgs: IngestionOutput, osm: IngestionOutput, merged: MergedIngestionOutput): string {
  return `# TrailScout Ingestion Report

- Run: ${merged.meta.runId}
- Label: ${merged.meta.label}
- BBox: south ${SAN_JUAN_BBOX.south}, west ${SAN_JUAN_BBOX.west}, north ${SAN_JUAN_BBOX.north}, east ${SAN_JUAN_BBOX.east}

## Sources

- USGS/TNM normalized trails: ${usgs.meta.normalizedCount}
- OSM normalized trails: ${osm.meta.normalizedCount}
- Merged trail records: ${merged.meta.normalizedCount}
- Duplicate candidates: ${merged.duplicateCandidates.length}
- Linked OSM context records: ${merged.linkedSourceRecordCount}

## Validation Issues

- USGS/TNM issues: ${usgs.meta.validationIssueCount}
- OSM issues: ${osm.meta.validationIssueCount}
- Merged issues: ${merged.meta.validationIssueCount}

## Notes

- USGS/TNM layer 37 is treated as the primary geometry source when a duplicate candidate is found.
- OSM records are retained as context via linked source IDs; unmatched OSM records remain in merged output.
- This report is a first-pass ingestion artifact and is not a navigation or conditions product.
`;
}

async function main(): Promise<void> {
  const id = runId();
  const tnmEndpoint = process.env.TNM_TRANSPORTATION_MAPSERVER_URL || DEFAULT_TNM_TRANSPORTATION_MAPSERVER;
  const usgsFetch = await fetchUsgsNdtTrails(SAN_JUAN_BBOX, tnmEndpoint);
  const usgs = ingestionOutput(
    id,
    'usgs-tnm-trails',
    'USGS The National Map Transportation Trails',
    `${tnmEndpoint.replace(/\/$/, '')}/37`,
    usgsFetch.records.length,
    usgsFetch.records,
  );

  const osmResponse = await queryOverpass(buildOverpassRequestBody(SAN_JUAN_BBOX));
  if (osmResponse.status !== 200) {
    throw new Error(`Overpass proxy failed with HTTP ${osmResponse.status}: ${osmResponse.text.slice(0, 180)}`);
  }
  const osmRaw = JSON.parse(osmResponse.text);
  const osmRecords = normalizeOverpassResponse(osmRaw);
  const osm = ingestionOutput(
    id,
    'osm-overpass',
    'OpenStreetMap via Overpass',
    osmResponse.endpoint || 'Overpass mirror',
    Array.isArray(osmRaw.elements) ? osmRaw.elements.length : 0,
    osmRecords,
  );

  const mergedResult = mergeWithDuplicateLinks(usgs.records, osm.records);
  const merged: MergedIngestionOutput = {
    meta: {
      runId: id,
      label: LABEL,
      sourceId: 'merged-usgs-tnm-osm',
      sourceName: 'Merged USGS/TNM + OSM',
      fetchedAt: new Date().toISOString(),
      bbox: SAN_JUAN_BBOX,
      endpoint: `${usgs.meta.endpoint}; ${osm.meta.endpoint}`,
      featureCount: usgs.meta.featureCount + osm.meta.featureCount,
      normalizedCount: mergedResult.records.length,
      validationIssueCount: validationIssueCount(mergedResult.records),
    },
    records: mergedResult.records,
    duplicateCandidates: mergedResult.duplicateCandidates,
    linkedSourceRecordCount: mergedResult.linkedSourceRecordCount,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, `run-${id}-${LABEL}-usgs-ndt.json`), `${JSON.stringify(usgs, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_DIR, `run-${id}-${LABEL}-osm.json`), `${JSON.stringify(osm, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_DIR, `run-${id}-${LABEL}-merged.json`), `${JSON.stringify(merged, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_DIR, `run-${id}-${LABEL}-report.md`), reportMarkdown(usgs, osm, merged));

  console.log(`[TrailScout ingestion] wrote run ${id} to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error('[TrailScout ingestion] run failed:', error);
  process.exitCode = 1;
});
