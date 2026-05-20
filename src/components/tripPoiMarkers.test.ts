import { describe, expect, it } from 'vitest';
import type { MultiDayItinerary } from '../planner';
import { buildTripPoiMarkers } from './tripPoiMarkers';

const itinerary: MultiDayItinerary = {
  totalKm: 42,
  campsitesFound: 2,
  warnings: [],
  disclaimer: 'test',
  hasStatusData: true,
  days: [
    {
      day: 1,
      startKm: 0,
      endKm: 12,
      distanceKm: 12,
      campsite: {
        id: 1,
        name: 'Verified Night One Campground',
        lat: 39.1,
        lng: -106.1,
        siteType: 'campground',
        water: true,
        fee: false,
        capacity: 10,
        packInOut: false,
        openSeason: '',
        activities: ['CAMPING'],
        permits: '',
        restrictions: '',
        trailKm: 12,
        offsetKm: 0.2,
      },
      approvedSite: true,
      campsiteRecommendation: {
        type: 'confirmed_campground',
        source: 'RIDB + USFS EDW',
        provider: 'Recreation.gov/RIDB + USFS EDW',
        facilityName: 'Verified Night One Campground',
        distanceFromRouteKm: 0.2,
        confidenceLevel: 'high',
        publicDataBacked: true,
        officialCampingFacility: true,
        currentAvailabilityConfirmed: true,
        permissionConfirmed: true,
        permissionStatus: 'confirmed',
        status: 'confirmed',
      },
      wilderness: false,
      notes: 'test',
      campsiteStatus: 'confirmed',
    },
    {
      day: 2,
      startKm: 12,
      endKm: 24,
      distanceKm: 12,
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
      notes: 'no camp',
    },
  ],
};

describe('buildTripPoiMarkers', () => {
  it('numbers overnight campsite markers by camping night and excludes unverified missing stops', () => {
    const markers = buildTripPoiMarkers(itinerary, []);

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      name: 'Night 1: Verified Night One Campground',
      type: 'campsite',
      night: 1,
      status: 'confirmed',
      lat: 39.1,
      lng: -106.1,
    });
  });
});
