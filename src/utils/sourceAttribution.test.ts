import { describe, expect, it } from 'vitest';
import type { TrailData } from '../services/osmService';
import { buildTrailSourceAttribution, primarySourceLabel, trailSourceConfidence } from './sourceAttribution';

function trail(tags: Record<string, string>): TrailData {
  return {
    id: 1,
    name: 'Test Trail',
    path: [
      { lat: 39, lng: -106 },
      { lat: 39.1, lng: -106 },
    ],
    tags,
  };
}

describe('source attribution', () => {
  it('classifies COTREX as an official public source with URL support', () => {
    const t = trail({
      trailscout_source: 'cotrex',
      cotrex_feature_id: '123',
      url: 'https://trails.colorado.gov/trail/test',
    });
    const attribution = buildTrailSourceAttribution(t);
    expect(attribution[0]).toMatchObject({
      name: 'Colorado Trail Explorer (COTREX)',
      kind: 'official_public',
      url: 'https://trails.colorado.gov/trail/test',
    });
    expect(trailSourceConfidence(t)).toBeGreaterThan(80);
  });

  it('labels OSM way segments as lower confidence community-maintained public data', () => {
    const t = trail({ trailscout_source: 'osm_way_segment' });
    expect(primarySourceLabel(t)).toBe('OpenStreetMap way segment');
    expect(buildTrailSourceAttribution(t)[0].warnings.join(' ')).toMatch(/part of a larger trail/i);
  });
});
