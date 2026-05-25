import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/usgs-ndt-san-juan.sample.json';
import { buildTnmTrailsQueryUrl, normalizeUsgsNdtFeatureCollection, SAN_JUAN_BBOX, TNM_TRAILS_LAYER_ID } from './usgs-ndt';

describe('USGS/TNM normalization', () => {
  it('builds a configurable TNM Trails layer query URL', () => {
    const url = buildTnmTrailsQueryUrl('https://example.test/transportation/MapServer', SAN_JUAN_BBOX, 2000);

    expect(url).toContain(`/${TNM_TRAILS_LAYER_ID}/query?`);
    expect(url).toContain('f=geojson');
    expect(url).toContain('outSR=4326');
    expect(url).toContain('resultOffset=2000');
  });

  it('normalizes TNM trail features with source attribution and allowed uses', () => {
    const records = normalizeUsgsNdtFeatureCollection(fixture);
    const stoner = records[0];

    expect(stoner.id).toBe('usgs-tnm:tnm-stoner-creek');
    expect(stoner.canonicalName).toBe('Stoner Creek');
    expect(stoner.alternateNames).toContain('Stoner Creek Trail');
    expect(stoner.allowedUses).toContain('hiking');
    expect(stoner.allowedUses).toContain('Packsaddle');
    expect(stoner.geometry).toHaveLength(3);
    expect(stoner.originalGeometry).toBeTruthy();
    expect(stoner.lengthMiles).toBeCloseTo(2.11816604);
    expect(stoner.sourceAttribution[0].sourceId).toBe('usgs-tnm-trails');
    expect(stoner.validationIssues).toEqual([]);
  });

  it('flags missing name and bad geometry without dropping the source record', () => {
    const records = normalizeUsgsNdtFeatureCollection(fixture);
    const bad = records[1];

    expect(bad.canonicalName).toBe('USGS TNM Trail 999');
    expect(bad.validationIssues).toContain('missing trail name');
    expect(bad.validationIssues).toContain('line geometry has fewer than 2 points');
  });
});
