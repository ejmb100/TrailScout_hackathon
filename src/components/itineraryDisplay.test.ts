import { describe, expect, it } from 'vitest';
import type { DaySegment, MultiDayItinerary } from '../planner';
import { buildDaySegmentLabel, getCampNightCoverage } from './itineraryDisplay';

function segment(over: Partial<DaySegment>): DaySegment {
  return {
    day: 1,
    startKm: 0,
    endKm: 10,
    distanceKm: 10,
    campsite: null,
    approvedSite: false,
    campsiteRecommendation: {
      type: 'unknown_unverified',
      source: null,
      provider: null,
      facilityName: null,
      distanceFromRouteKm: null,
      confidenceLevel: 'unknown',
      publicDataBacked: false,
      officialCampingFacility: false,
      currentAvailabilityConfirmed: false,
      permissionConfirmed: false,
      permissionStatus: 'unknown',
      status: 'not_found',
    },
    wilderness: false,
    notes: 'test',
    ...over,
  };
}

function mappedCampRecommendation(): DaySegment['campsiteRecommendation'] {
  return {
    type: 'official_camping_facility_unverified',
    source: 'USFS EDW',
    provider: 'USFS EDW',
    facilityName: 'Test Camp',
    distanceFromRouteKm: 0.1,
    confidenceLevel: 'low',
    publicDataBacked: true,
    officialCampingFacility: true,
    currentAvailabilityConfirmed: false,
    permissionConfirmed: false,
    permissionStatus: 'official_facility_unverified',
    status: 'unverified',
  };
}

const itinerary: MultiDayItinerary = {
  totalKm: 48,
  campsitesFound: 2,
  warnings: [],
  disclaimer: 'test',
  hasStatusData: true,
  days: [
    segment({
      day: 1,
      startKm: 0,
      endKm: 12.4,
      distanceKm: 12.4,
      campsite: { id: 1, name: 'First Camp', lat: 39, lng: -106, siteType: 'campground', water: true, fee: false, capacity: 6, packInOut: false, openSeason: '', activities: ['CAMPING'], permits: '', restrictions: '', trailKm: 12.4, offsetKm: 0.1 },
      campsiteRecommendation: mappedCampRecommendation(),
    }),
    segment({
      day: 2,
      startKm: 12.4,
      endKm: 25,
      distanceKm: 12.6,
      campsite: { id: 2, name: 'Second Camp', lat: 39.1, lng: -106, siteType: 'campground', water: null, fee: false, capacity: 6, packInOut: false, openSeason: '', activities: ['CAMPING'], permits: '', restrictions: '', trailKm: 25, offsetKm: 0.1 },
      campsiteRecommendation: mappedCampRecommendation(),
    }),
    segment({ day: 3, startKm: 25, endKm: 48, distanceKm: 23 }),
  ],
};

describe('itinerary display helpers', () => {
  it('labels each day by the distance between start/camp/exit points', () => {
    expect(buildDaySegmentLabel(itinerary, itinerary.days[0])).toContain('Start → Night 1 camp');
    expect(buildDaySegmentLabel(itinerary, itinerary.days[0])).toContain('12.4 km');
    expect(buildDaySegmentLabel(itinerary, itinerary.days[1])).toContain('Night 1 camp → Night 2 camp');
    expect(buildDaySegmentLabel(itinerary, itinerary.days[2])).toContain('Night 2 camp → Finish');
  });

  it('labels missing overnight endpoints without implying a mapped campsite', () => {
    const partial: MultiDayItinerary = {
      ...itinerary,
      days: [
        segment({ day: 1, startKm: 0, endKm: 15, distanceKm: 15, campsite: null }),
        segment({
          day: 2,
          startKm: 15,
          endKm: 35,
          distanceKm: 20,
          campsite: { id: 3, name: 'Mapped Camp', lat: 39.2, lng: -106, siteType: 'campground', water: null, fee: false, capacity: 6, packInOut: false, openSeason: '', activities: ['CAMPING'], permits: '', restrictions: '', trailKm: 35, offsetKm: 0.1 },
          campsiteRecommendation: mappedCampRecommendation(),
        }),
        segment({ day: 3, startKm: 35, endKm: 48, distanceKm: 13, campsite: null }),
      ],
    };

    expect(buildDaySegmentLabel(partial, partial.days[0])).toContain('Start → Unverified Night 1 stop');
    expect(buildDaySegmentLabel(partial, partial.days[1])).toContain('Unverified Night 1 stop → Night 2 camp');
    expect(buildDaySegmentLabel(partial, partial.days[2])).toContain('Night 2 camp → Finish');
  });

  it('reports mapped camp-night coverage separately from trip days', () => {
    expect(getCampNightCoverage(itinerary, 4)).toEqual({ mapped: 2, expected: 3, complete: false });
  });
});
