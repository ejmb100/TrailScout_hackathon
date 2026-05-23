import { describe, expect, it } from 'vitest';
import type { IntentProfile, TrailCandidate, ValidationResult } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import { assessFeasibility } from './feasibility';
import { assessSafety } from './safety';
import { integratePlanner } from './rank';
import { fetchCampsitesInBBox } from '../services/campsiteService';
import { buildMultiDayItinerary } from './itinerary';

function baseIntent(over: Partial<IntentProfile> = {}): IntentProfile {
  return {
    location: 'Testland',
    date: 'today',
    difficulty: 'moderate',
    tripType: 'day_hike',
    tripLengthDays: 1,
    maxDistanceKm: 10,
    dailyDistanceKm: 10,
    searchDistanceKm: 10,
    elevationPreference: 'any',
    sceneryPreferences: [],
    crowdPreference: 'any',
    dogFriendly: false,
    kidFriendly: false,
    weatherTolerance: 'any',
    latestReturnTime: '',
    driveTimeTolerance: 'any',
    reasoning: 'test',
    estimatedRegionName: 'Test',
    bbox: { minLat: 45, maxLat: 46, minLon: 9, maxLon: 10 },
    followUpQuestions: [],
    ...over,
  };
}

function shortTrail(over: Partial<TrailData> = {}): TrailData {
  return {
    id: 1,
    name: 'Shorty',
    path: [
      { lat: 45.0, lng: 9.0 },
      { lat: 45.002, lng: 9.002 },
    ],
    tags: { trailscout_source: 'osm_relation', sac_scale: 'hiking' },
    ...over,
  };
}

describe('assessFeasibility', () => {
  it('blocks when mapped length is far below day-hike target', () => {
    const intent = baseIntent({ maxDistanceKm: 10, tripType: 'day_hike' });
    const r = assessFeasibility(intent, shortTrail());
    expect(r.eligible).toBe(false);
    expect(r.blockingReasons.some((b) => b.includes('shorter'))).toBe(true);
  });

  it('blocks a short trail for multi-day even when ratio looks acceptable', () => {
    const intent = baseIntent({
      tripType: 'multi_day',
      tripLengthDays: 3,
      maxDistanceKm: 10,
      dailyDistanceKm: 12,
      searchDistanceKm: 36,
    });
    const trail: TrailData = {
      id: 3,
      name: 'Short Segment',
      path: [
        { lat: 45.0, lng: 9.0 },
        { lat: 45.05, lng: 9.05 },
        { lat: 45.08, lng: 9.08 },
      ],
      tags: { trailscout_source: 'usfs_nfs' },
    };
    const r = assessFeasibility(intent, trail);
    expect(r.eligible).toBe(false);
    expect(r.blockingReasons.some((b) => b.includes('too short for a multi-day'))).toBe(true);
  });

  it('does not apply return-time gate when latestReturnTime is empty', () => {
    const intent = baseIntent({ maxDistanceKm: 5, latestReturnTime: '' });
    const trail: TrailData = {
      id: 2,
      name: 'Ok loop',
      path: [
        { lat: 45.0, lng: 9.0 },
        { lat: 45.02, lng: 9.02 },
      ],
      tags: { trailscout_source: 'osm_relation', sac_scale: 'mountain_hiking' },
    };
    const r = assessFeasibility(intent, trail);
    expect(r.blockingReasons.some((b) => b.includes('return'))).toBe(false);
  });
});

describe('assessSafety', () => {
  it('adds seasonal snow/ice warnings for Colorado alpine routes when the user asks for a winter month', () => {
    const intent = baseIntent({
      location: 'Colorado',
      date: 'February',
      difficulty: 'moderate',
      tripType: 'multi_day',
    });
    const trail = shortTrail({
      tags: {
        ...shortTrail().tags,
        cotrex_max_elevation_m: '3350',
        cotrex_min_elevation_m: '2850',
      },
    });
    const r = assessSafety(intent, trail, null, 'five day hike in Colorado in February');

    expect(r.tier).toBe('high');
    expect(r.warnings.join(' ')).toMatch(/snow|ice|microspikes|crampons/i);
  });

  it('blocks fair-weather intent when precipitation probability is high', () => {
    const intent = baseIntent({ weatherTolerance: 'fair_only' });
    const trail = shortTrail({ tags: { ...shortTrail().tags, sac_scale: 'hiking' } });
    const r = assessSafety(intent, trail, {
      summary: 'Rain likely',
      precipProbMax: 72,
      matchedDate: '2025-01-01',
    });
    expect(r.blockingFindings.some((b) => b.includes('rain chance'))).toBe(true);
  });

  it('blocks dog-friendly intent when OSM says dogs=no', () => {
    const intent = baseIntent({ dogFriendly: true });
    const trail = shortTrail({ tags: { ...shortTrail().tags, dog: 'no' } });
    const r = assessSafety(intent, trail, null);
    expect(r.blockingFindings.some((b) => b.toLowerCase().includes('dog'))).toBe(true);
  });

  it('blocks easy intent when SAC scale is too high', () => {
    const intent = baseIntent({ difficulty: 'easy' });
    const trail = shortTrail({ tags: { ...shortTrail().tags, sac_scale: 'demanding_mountain_hiking' } });
    const r = assessSafety(intent, trail, null);
    expect(r.blockingFindings.length).toBeGreaterThan(0);
  });

  it('blocks kid-friendly intent for T3+ terrain', () => {
    const intent = baseIntent({ kidFriendly: true });
    const trail = shortTrail({ tags: { ...shortTrail().tags, sac_scale: 't3' } });
    const r = assessSafety(intent, trail, null);
    expect(r.blockingFindings.some((b) => b.includes('kid'))).toBe(true);
  });
});

describe('buildMultiDayItinerary', () => {
  it('does not invent overnight campsites when no public campsite data is available near a segment', () => {
    const trail: TrailData = {
      id: 200,
      name: 'Long Trail With No Campsite Data',
      path: [
        { lat: 37.0, lng: -107.0 },
        { lat: 37.18, lng: -107.0 },
        { lat: 37.36, lng: -107.0 },
      ],
      tags: { trailscout_source: 'usfs_nfs' },
    };

    const itinerary = buildMultiDayItinerary(trail.path, 2, trail, { targetDailyKm: 20, campsiteStatuses: [] });
    const overnight = itinerary.days[0];

    expect(overnight.campsite).toBeNull();
    expect(overnight.approvedSite).toBe(false);
    expect(overnight.notes).toContain('No confirmed legal campsite or campground was found near this segment based on available public data.');
    expect(overnight.campsiteRecommendation).toMatchObject({
      type: 'unknown_unverified',
      publicDataBacked: false,
      officialCampingFacility: false,
      currentAvailabilityConfirmed: false,
      permissionConfirmed: false,
      permissionStatus: 'unknown',
      confidenceLevel: 'unknown',
    });
  });

  it('keeps building later days when an earlier overnight window has no verified campsite', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              OBJECTID: 99101,
              SITE_NAME: 'Later Valley Campground',
              SITE_TYPE: 'CAMPGROUND',
              ACTIVITY_TYPE_LIST: 'CAMPING',
              FEE_CHARGED: 'N',
              WATER_AVAILABILITY: '',
              TOTAL_CAPACITY: 8,
              LATITUDE: 39.315,
              LONGITUDE: -106.0,
              PACK_IN_OUT: 'N',
              OPEN_SEASON: '',
              PERMIT_INFORMATION: '',
              RESTRICTIONS: '',
            },
          },
          {
            attributes: {
              OBJECTID: 99102,
              SITE_NAME: 'Upper Basin Campground',
              SITE_TYPE: 'CAMPGROUND',
              ACTIVITY_TYPE_LIST: 'CAMPING',
              FEE_CHARGED: 'N',
              WATER_AVAILABILITY: '',
              TOTAL_CAPACITY: 8,
              LATITUDE: 39.45,
              LONGITUDE: -106.0,
              PACK_IN_OUT: 'N',
              OPEN_SEASON: '',
              PERMIT_INFORMATION: '',
              RESTRICTIONS: '',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    try {
      await fetchCampsitesInBBox(39.0, -106.1, 39.6, -105.9);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const trail: TrailData = {
      id: 202,
      name: 'Trail With Early Campsite Gap',
      path: [
        { lat: 39.0, lng: -106.0 },
        { lat: 39.54, lng: -106.0 },
      ],
      tags: { trailscout_source: 'usfs_nfs' },
    };

    const itinerary = buildMultiDayItinerary(trail.path, 4, trail, { targetDailyKm: 15, campsiteStatuses: [] });

    expect(itinerary.days).toHaveLength(4);
    expect(itinerary.days[0].campsite).toBeNull();
    expect(itinerary.days[1].campsite?.name).toBe('Later Valley Campground');
    expect(itinerary.days[2].campsite?.name).toBe('Upper Basin Campground');
    expect(itinerary.campsitesFound).toBe(2);
  });

  it('treats EDW-only camping facilities as public-data-backed but not currently confirmed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        features: [{
          attributes: {
            OBJECTID: 99001,
            SITE_NAME: 'EDW Only Test Campground',
            SITE_TYPE: 'CAMPGROUND',
            ACTIVITY_TYPE_LIST: 'CAMPING',
            FEE_CHARGED: 'N',
            WATER_AVAILABILITY: '',
            TOTAL_CAPACITY: 10,
            LATITUDE: 39.18,
            LONGITUDE: -106.0,
            PACK_IN_OUT: 'N',
            OPEN_SEASON: '',
            PERMIT_INFORMATION: '',
            RESTRICTIONS: '',
          },
        }],
      }),
    })) as unknown as typeof fetch;

    try {
      await fetchCampsitesInBBox(39.0, -106.1, 39.4, -105.9);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const trail: TrailData = {
      id: 201,
      name: 'Trail With EDW Only Campground',
      path: [
        { lat: 39.0, lng: -106.0 },
        { lat: 39.18, lng: -106.0 },
        { lat: 39.36, lng: -106.0 },
      ],
      tags: { trailscout_source: 'usfs_nfs' },
    };

    const itinerary = buildMultiDayItinerary(trail.path, 2, trail, { targetDailyKm: 20, campsiteStatuses: [] });
    const overnight = itinerary.days[0];

    expect(overnight.campsite?.name).toBe('EDW Only Test Campground');
    expect(overnight.approvedSite).toBe(false);
    expect(overnight.notes).toContain('current availability must be verified');
    expect(overnight.campsiteRecommendation).toMatchObject({
      type: 'official_camping_facility_unverified',
      publicDataBacked: true,
      officialCampingFacility: true,
      currentAvailabilityConfirmed: false,
      permissionConfirmed: false,
      permissionStatus: 'official_facility_unverified',
      confidenceLevel: 'low',
      source: 'USFS EDW',
      provider: 'USFS EDW',
    });
  });
});

describe('integratePlanner', () => {
  it('produces no primary when every candidate fails gates', () => {
    const intent = baseIntent({ maxDistanceKm: 12, dogFriendly: true });
    const t1 = shortTrail({ id: 101, tags: { trailscout_source: 'osm_relation', sac_scale: 'hiking', dog: 'no' } });
    const t2 = shortTrail({
      id: 102,
      tags: { trailscout_source: 'osm_relation', sac_scale: 'hiking' },
      path: t1.path,
    });
    const byId = new Map<number, TrailData>([
      [101, t1],
      [102, t2],
    ]);
    const candidates: TrailCandidate[] = [
      {
        trailId: 101,
        trailName: 'A',
        matchScore: 95,
        matchExplanation: 'LLM likes it',
        estimatedDriveTime: '30m',
        weatherForecast: 'ok',
        crowdLevel: 'low',
        bestTimeToGo: '9am',
        sceneryHighlights: [],
        trailImageQuery: 'a',
        distanceKm: 0.3,
      },
      {
        trailId: 102,
        trailName: 'B',
        matchScore: 90,
        matchExplanation: 'second',
        estimatedDriveTime: '30m',
        weatherForecast: 'ok',
        crowdLevel: 'low',
        bestTimeToGo: '9am',
        sceneryHighlights: [],
        trailImageQuery: 'b',
        distanceKm: 0.3,
      },
    ];
    const validations: ValidationResult[] = candidates.map((c, i) => ({
      trailId: c.trailId,
      trailName: c.trailName,
      overallFit: 'excellent',
      confidenceScore: 90,
      passedChecks: [],
      warnings: [],
      risks: [],
      isRecommended: i === 0,
    }));

    const out = integratePlanner(intent, null, byId, candidates, validations);
    expect(out.recommendation.primaryTrailId).toBeNull();
    expect(out.recommendation.status).toBe('none');
    expect(out.validations.every((v) => !v.isRecommended)).toBe(true);
  });
});
