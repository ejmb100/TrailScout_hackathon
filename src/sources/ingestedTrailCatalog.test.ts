import { describe, expect, it } from 'vitest';
import osmFixture from './__fixtures__/osm-overpass-san-juan.sample.json';
import usgsFixture from './__fixtures__/usgs-ndt-san-juan.sample.json';
import { mergeWithDuplicateLinks } from './dedupe';
import {
  createIngestedTrailCatalog,
  ingestedRecordToTrailData,
  queryIngestedTrailCatalog,
  queryIngestedTrailData,
} from './ingestedTrailCatalog';
import { normalizeOverpassResponse } from './osm';
import type { MergedIngestionOutput } from './types';
import { normalizeUsgsNdtFeatureCollection, SAN_JUAN_BBOX } from './usgs-ndt';

function fixtureMergedOutput(): MergedIngestionOutput {
  const usgs = normalizeUsgsNdtFeatureCollection(usgsFixture);
  const osm = normalizeOverpassResponse(osmFixture);
  const merged = mergeWithDuplicateLinks(usgs, osm);

  return {
    meta: {
      runId: 'fixture-run',
      label: 'san-juan',
      sourceId: 'merged-usgs-tnm-osm',
      sourceName: 'Merged USGS/TNM + OSM',
      fetchedAt: '2026-05-25T00:00:00Z',
      bbox: SAN_JUAN_BBOX,
      endpoint: 'fixture',
      featureCount: usgs.length + osm.length,
      normalizedCount: merged.records.length,
      validationIssueCount: 0,
    },
    records: merged.records,
    duplicateCandidates: merged.duplicateCandidates,
    linkedSourceRecordCount: merged.linkedSourceRecordCount,
  };
}

describe('ingested trail catalog', () => {
  it('builds an id-indexed catalog from merged ingestion output', () => {
    const catalog = createIngestedTrailCatalog(fixtureMergedOutput());

    expect(catalog.runId).toBe('fixture-run');
    expect(catalog.byId.get('usgs-tnm:tnm-stoner-creek')?.canonicalName).toBe('Stoner Creek');
  });

  it('filters by bbox and text while excluding invalid geometry by default', () => {
    const catalog = createIngestedTrailCatalog(fixtureMergedOutput());
    const records = queryIngestedTrailCatalog(catalog, {
      bbox: { south: 37.6, west: -108.3, north: 37.65, east: -108.24 },
      text: 'Stoner',
    });

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('usgs-tnm:tnm-stoner-creek');
    expect(records[0].validationIssues.some((issue) => issue.includes('linked'))).toBe(true);
  });

  it('can include invalid geometry when requested', () => {
    const catalog = createIngestedTrailCatalog(fixtureMergedOutput());
    const records = queryIngestedTrailCatalog(catalog, {
      text: 'USGS TNM Trail 999',
      includeInvalidGeometry: true,
    });

    expect(records).toHaveLength(1);
    expect(records[0].validationIssues).toContain('line geometry has fewer than 2 points');
  });

  it('converts ingested records into existing TrailData shape with attribution tags', () => {
    const catalog = createIngestedTrailCatalog(fixtureMergedOutput());
    const trailData = queryIngestedTrailData(catalog, { text: 'Stoner' });
    const trail = trailData[0];

    expect(trail.name).toBe('Stoner Creek');
    expect(trail.path).toHaveLength(3);
    expect(trail.tags.trailscout_source).toContain('usgs-tnm-trails');
    expect(trail.tags.trailscout_source).toContain('osm-overpass');
    expect(trail.tags.allowed_uses).toContain('hiking');
  });

  it('uses a stable numeric id fallback for non-numeric source ids', () => {
    const catalog = createIngestedTrailCatalog(fixtureMergedOutput());
    const record = catalog.byId.get('usgs-tnm:tnm-stoner-creek');

    expect(record).toBeTruthy();
    expect(ingestedRecordToTrailData(record!, 7).id).toBeGreaterThan(0);
  });
});
