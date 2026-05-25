import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/osm-overpass-san-juan.sample.json';
import { buildOverpassRequestBody, normalizeOverpassResponse } from './osm';
import { SAN_JUAN_BBOX } from './usgs-ndt';

describe('OSM normalization', () => {
  it('builds an Overpass request body for the San Juan bbox', () => {
    const body = buildOverpassRequestBody(SAN_JUAN_BBOX);

    expect(body).toContain('data=');
    expect(decodeURIComponent(body)).toContain('relation["route"="hiking"]');
    expect(decodeURIComponent(body)).toContain('37,-108.5,38.5,-106.5');
  });

  it('normalizes OSM ways with source attribution and geometry', () => {
    const records = normalizeOverpassResponse(fixture);
    const stoner = records.find((record) => record.sourceRecordId === '100');

    expect(stoner).toBeTruthy();
    expect(stoner?.canonicalName).toBe('Stoner Creek Trail');
    expect(stoner?.allowedUses).toContain('hiking');
    expect(stoner?.trailSurface).toBe('dirt');
    expect(stoner?.difficultySignals).toContain('hiking');
    expect(stoner?.geometry).toHaveLength(3);
    expect(stoner?.sourceAttribution[0].sourceId).toBe('osm-overpass');
  });

  it('keeps records with missing names and bad geometry marked with validation issues', () => {
    const records = normalizeOverpassResponse(fixture);
    const bad = records.find((record) => record.sourceRecordId === '101');

    expect(bad?.canonicalName).toBe('OSM trail segment 101');
    expect(bad?.validationIssues).toContain('missing trail name');
    expect(bad?.validationIssues).toContain('line geometry has fewer than 2 points');
  });
});
