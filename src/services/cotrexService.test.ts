import { describe, expect, it, vi } from 'vitest';
import { fetchCotrexTrailsInBBox, normalizeCotrexFeature } from './cotrexService';

const baseFeature = {
  attributes: {
    FID: 123,
    feature_id: 'cot-123',
    name: 'Colorado Trail Segment 7',
    length_mi_: 24.9,
    hiking: 'yes',
    access: 'open',
    dogs: 'yes',
    manager: 'Colorado Parks and Wildlife',
    min_elevat: 2800,
    max_elevat: 3400,
    surface: 'dirt',
    type: 'Trail',
    url: 'https://trails.colorado.gov/trails/colorado-6508',
  },
  geometry: {
    paths: [[[-106.0, 39.0], [-106.1, 39.1]]],
  },
};

describe('normalizeCotrexFeature', () => {
  it('turns a hiking-enabled COTREX line feature into authoritative TrailData', () => {
    const trail = normalizeCotrexFeature(baseFeature);

    expect(trail).not.toBeNull();
    expect(trail?.name).toBe('Colorado Trail Segment 7');
    expect(trail?.path).toEqual([
      { lat: 39, lng: -106 },
      { lat: 39.1, lng: -106.1 },
    ]);
    expect(trail?.tags).toMatchObject({
      trailscout_source: 'cotrex',
      cotrex_feature_id: 'cot-123',
      trailscout_length_km: '40.1',
      hiking: 'yes',
      access: 'open',
      dog: 'yes',
      manager: 'Colorado Parks and Wildlife',
    });
  });

  it('rejects non-hiking COTREX features so OHV-only routes are not suggested as backpacking trips', () => {
    const trail = normalizeCotrexFeature({
      ...baseFeature,
      attributes: { ...baseFeature.attributes, hiking: 'no', bike: 'yes' },
    });

    expect(trail).toBeNull();
  });

  it('includes the ArcGIS input spatial reference so Colorado bbox queries return COTREX features', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [baseFeature] }),
    })) as unknown as typeof fetch;
    globalThis.fetch = mockFetch;

    try {
      const trails = await fetchCotrexTrailsInBBox(39.604, -105.796, 39.996, -105.404);
      const requestedUrl = String(vi.mocked(mockFetch).mock.calls[0][0]);
      expect(requestedUrl).toContain('inSR=4326');
      expect(trails).toHaveLength(1);
      expect(trails[0].tags.trailscout_source).toBe('cotrex');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
