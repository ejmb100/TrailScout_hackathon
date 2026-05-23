import { describe, expect, it } from 'vitest';
import type { IntentProfile } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import { computeDeterministicMatchScore, scoreAndFilterTrails } from './trailScoring';

function multiDayIntent(over: Partial<IntentProfile> = {}): IntentProfile {
  return {
    location: 'Colorado',
    date: 'today',
    difficulty: 'moderate',
    tripType: 'multi_day',
    tripLengthDays: 5,
    maxDistanceKm: 60,
    dailyDistanceKm: 12,
    searchDistanceKm: 60,
    elevationPreference: 'any',
    sceneryPreferences: ['mountain'],
    crowdPreference: 'any',
    dogFriendly: false,
    kidFriendly: false,
    weatherTolerance: 'any',
    latestReturnTime: '',
    driveTimeTolerance: 'any',
    reasoning: 'test',
    estimatedRegionName: 'Colorado',
    bbox: { minLat: 38.5, maxLat: 40, minLon: -107, maxLon: -105 },
    followUpQuestions: [],
    ...over,
  };
}

function trail(over: Partial<TrailData>): TrailData {
  return {
    id: 1,
    name: 'Trail',
    path: [
      { lat: 39.0, lng: -106.0 },
      { lat: 39.1, lng: -106.0 },
    ],
    tags: { trailscout_source: 'osm_way_segment' },
    ...over,
  };
}

describe('Colorado multi-day scoring', () => {
  it('prefers an authoritative COTREX trail with target-length metadata over a short OSM segment', () => {
    const cotrex = trail({
      id: -2000123,
      name: 'Colorado Trail Mountain Section',
      tags: {
        trailscout_source: 'cotrex',
        trailscout_length_km: '61.0',
        hiking: 'yes',
        manager: 'Colorado Parks and Wildlife',
      },
    });
    const osmShort = trail({
      id: 9,
      name: 'Short OSM Spur',
      path: [
        { lat: 39.0, lng: -106.0 },
        { lat: 39.03, lng: -106.0 },
      ],
      tags: { trailscout_source: 'osm_way_segment' },
    });

    const ranked = scoreAndFilterTrails([osmShort, cotrex], {
      difficulty: 'intermediate',
      features: ['mountain'],
      terrain: [],
      maxDistance: 60,
      tripType: 'multi_day',
      reasoning: 'test',
      locationQuery: 'Colorado',
      estimatedRegionName: 'Colorado',
    });

    expect(ranked[0].id).toBe(cotrex.id);
    expect(computeDeterministicMatchScore(cotrex, multiDayIntent())).toBeGreaterThan(
      computeDeterministicMatchScore(osmShort, multiDayIntent())
    );
  });

  it('prefers an assembled route over an individual short segment for multi-day requests', () => {
    const assembled = trail({
      id: -7000000,
      name: 'Colorado Trail assembled route',
      tags: {
        trailscout_source: 'assembled_route',
        trailscout_length_km: '80.0',
        assembled_segment_count: '4',
        assembled_sources: 'cotrex',
      },
    });
    const shortSegment = trail({
      id: -2000014,
      name: 'Colorado Trail Segment 14',
      tags: {
        trailscout_source: 'cotrex',
        trailscout_length_km: '21.6',
        hiking: 'yes',
      },
    });

    const ranked = scoreAndFilterTrails([shortSegment, assembled], {
      difficulty: 'intermediate',
      features: ['mountain'],
      terrain: [],
      maxDistance: 80,
      tripType: 'multi_day',
      reasoning: 'test',
      locationQuery: 'Colorado',
      estimatedRegionName: 'Colorado',
    });

    expect(ranked[0].id).toBe(assembled.id);
  });

  it('does not relax multi-day scoring down to short day-hike length segments when no assembled route is available', () => {
    const shortSegments = [13, 18, 25].map((km, index) => trail({
      id: 100 + index,
      name: `Short Segment ${km} km`,
      tags: {
        trailscout_source: 'cotrex',
        trailscout_length_km: String(km),
        hiking: 'yes',
      },
    }));

    const ranked = scoreAndFilterTrails(shortSegments, {
      difficulty: 'intermediate',
      features: ['mountain'],
      terrain: [],
      maxDistance: 80,
      tripType: 'multi_day',
      reasoning: 'test',
      locationQuery: 'Colorado',
      estimatedRegionName: 'Colorado',
    });

    expect(ranked).toHaveLength(0);
  });
});
