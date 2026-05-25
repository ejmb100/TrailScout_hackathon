import { describe, expect, it } from 'vitest';
import osmFixture from './__fixtures__/osm-overpass-san-juan.sample.json';
import usgsFixture from './__fixtures__/usgs-ndt-san-juan.sample.json';
import { findDuplicateCandidates, mergeWithDuplicateLinks } from './dedupe';
import { normalizeOverpassResponse } from './osm';
import { normalizeUsgsNdtFeatureCollection } from './usgs-ndt';

describe('source dedupe', () => {
  it('creates conservative duplicate candidates using name and representative point proximity', () => {
    const usgs = normalizeUsgsNdtFeatureCollection(usgsFixture);
    const osm = normalizeOverpassResponse(osmFixture);
    const candidates = findDuplicateCandidates(usgs, osm);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      primaryId: 'usgs-tnm:tnm-stoner-creek',
      duplicateId: 'osm:osm_way:100',
      primarySourceId: 'usgs-tnm-trails',
      duplicateSourceId: 'osm-overpass',
    });
    expect(candidates[0].centroidDistanceMeters).toBeLessThanOrEqual(400);
  });

  it('keeps USGS/TNM geometry while linking duplicate OSM context', () => {
    const usgs = normalizeUsgsNdtFeatureCollection(usgsFixture);
    const osm = normalizeOverpassResponse(osmFixture);
    const merged = mergeWithDuplicateLinks(usgs, osm);
    const primary = merged.records.find((record) => record.id === 'usgs-tnm:tnm-stoner-creek');

    expect(primary?.geometry).toEqual(usgs[0].geometry);
    expect(primary?.sourceIds).toContain('osm-overpass');
    expect(primary?.sourceIds).toContain('osm:osm_way:100');
    expect(merged.linkedSourceRecordCount).toBe(1);
    expect(merged.records.some((record) => record.id === 'osm:osm_way:100')).toBe(false);
  });
});
