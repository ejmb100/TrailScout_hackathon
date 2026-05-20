import { describe, expect, it } from 'vitest';
import type { TrailData } from './osmService';
import { buildMultiDayRouteCandidates } from './routeBuilder';
import { effectiveTrailDistanceKm } from '../utils/trailScoring';

function segment(id: number, name: string, startLng: number, endLng: number, lengthKm = 20): TrailData {
  return {
    id,
    name,
    path: [
      { lat: 39, lng: startLng },
      { lat: 39, lng: endLng },
    ],
    tags: {
      trailscout_source: 'cotrex',
      hiking: 'yes',
      trailscout_length_km: String(lengthKm),
    },
  };
}

describe('buildMultiDayRouteCandidates', () => {
  it('stitches adjacent named Colorado Trail segments into a multi-day route candidate', () => {
    const trails = [
      segment(1, 'Colorado Trail Segment 14 - Mount Princeton to Chalk Creek', -106.30, -106.10),
      segment(2, 'Colorado Trail Segment 15 - Chalk Creek to Marshall Pass', -106.1008, -105.90),
      segment(3, 'Colorado Trail Segment 16 - Marshall Pass to Sargents Mesa', -105.9006, -105.70),
      segment(4, 'Unrelated Spur Trail', -106.2, -106.25, 5),
    ];

    const candidates = buildMultiDayRouteCandidates(trails, { targetKm: 60, maxCandidates: 4 });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].name).toBe('Colorado Trail assembled route');
    expect(candidates[0].tags.trailscout_source).toBe('assembled_route');
    expect(candidates[0].tags.assembled_segment_count).toBe('3');
    expect(candidates[0].tags.assembled_sources).toBe('cotrex');
    expect(candidates[0].path).toHaveLength(4);
    expect(effectiveTrailDistanceKm(candidates[0])).toBeCloseTo(60, 1);
  });

  it('does not stitch segments across large gaps or unrelated route families', () => {
    const trails = [
      segment(1, 'Colorado Trail Segment 14', -106.30, -106.10),
      segment(2, 'Colorado Trail Segment 15', -105.00, -104.80),
      segment(3, 'Continental Divide Trail', -106.1005, -105.90),
    ];

    const candidates = buildMultiDayRouteCandidates(trails, { targetKm: 60, maxCandidates: 4 });

    expect(candidates).toHaveLength(0);
  });
});
