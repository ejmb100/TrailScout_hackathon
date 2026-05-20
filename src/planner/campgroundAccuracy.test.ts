import { describe, expect, it } from 'vitest';
import type { Campsite } from '../services/campsiteService';
import { fetchCampsitesInBBox } from '../services/campsiteService';
import type { RidbFacility } from '../services/recreationGovService';
import type { ForestAlerts } from '../services/forestAlertService';
import { buildCampsiteStatuses } from '../services/campsiteStatusService';
import { buildMultiDayItinerary } from './itinerary';

function site(overrides: Partial<Campsite> = {}): Campsite {
  return {
    id: 100,
    name: 'Colorado Test Campground',
    lat: 39.0,
    lng: -106.0,
    siteType: 'campground',
    water: true,
    fee: false,
    capacity: 20,
    packInOut: false,
    openSeason: '',
    activities: ['CAMPING'],
    permits: '',
    restrictions: '',
    ...overrides,
  };
}

function ridb(overrides: Partial<RidbFacility> = {}): RidbFacility {
  return {
    facilityId: 'ridb-1',
    name: 'Colorado Test Campground',
    lat: 39.0,
    lng: -106.0,
    type: 'campground',
    enabled: true,
    reservable: true,
    description: '',
    stayLimit: '',
    lastUpdated: '2026-06-01',
    reservationUrl: '',
    parentOrgId: '131',
    ...overrides,
  };
}

function alerts(): ForestAlerts {
  return {
    perimeters: [],
    incidents: [],
    fetchedAt: '2026-01-15T00:00:00Z',
    hasActiveFiresInArea: false,
  };
}

describe('Colorado campground accuracy failure modes', () => {
  it('cycle 1: treats a seasonal Colorado campground as closed when trip date is outside its open season', () => {
    const statuses = buildCampsiteStatuses([
      site({ name: 'Twin Lakes Mountain Campground', openSeason: 'May 15 - September 30' }),
    ], [], alerts(), '2026-01-15T00:00:00Z');

    expect(statuses[0].status).toBe('seasonal_closure');
    expect(statuses[0].confidence).toBeGreaterThanOrEqual(70);
    expect(statuses[0].warnings.join(' ')).toMatch(/outside|seasonal/i);
  });

  it('cycle 2: rejects a day-use camping-area-looking record as an overnight stop', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        features: [{
          attributes: {
            OBJECTID: 201,
            SITE_NAME: 'Chatfield Picnic and Day Use Area',
            SITE_TYPE: 'CAMPING AREA',
            ACTIVITY_TYPE_LIST: 'PICNICKING|DAY USE AREA',
            FEE_CHARGED: 'N',
            WATER_AVAILABILITY: '',
            TOTAL_CAPACITY: 0,
            LATITUDE: 39.1,
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
      await fetchCampsitesInBBox(39.01, -106.05, 39.21, -105.95);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const path = [
      { lat: 39.0, lng: -106.0 },
      { lat: 39.1, lng: -106.0 },
      { lat: 39.2, lng: -106.0 },
    ];
    const fakeDayUse = site({
      id: 201,
      name: 'Chatfield Picnic and Day Use Area',
      siteType: 'camping_area',
      lat: 39.1,
      lng: -106.0,
      activities: ['PICNICKING', 'DAY USE AREA'],
    });
    const statuses = buildCampsiteStatuses([fakeDayUse], [], alerts(), '2026-06-15T00:00:00Z');
    const itinerary = buildMultiDayItinerary(path, 2, undefined, { campsiteStatuses: statuses });

    expect(itinerary.days[0].campsite).toBeNull();
    expect(itinerary.days[0].campsiteRecommendation.type).toBe('unknown_unverified');
    expect(itinerary.warnings.join(' ')).toMatch(/No confirmed legal campsite/i);
  });

  it('cycle 3: does not confirm an EDW campground from a nearby unrelated RIDB campground with a different name', () => {
    const statuses = buildCampsiteStatuses([
      site({ name: 'Remote Public Land Primitive Camp', lat: 38.8, lng: -107.2 }),
    ], [
      ridb({ name: 'Popular Lake RV Campground', lat: 38.805, lng: -107.205 }),
    ], alerts(), '2026-06-15T00:00:00Z');

    expect(statuses[0].ridbMatch).toBeNull();
    expect(statuses[0].status).not.toBe('confirmed');
    expect(statuses[0].warnings.join(' ')).toMatch(/No Recreation\.gov match/i);
  });

  it('cycle 4: stops a sparse-route itinerary at the first unverified overnight gap instead of fabricating later day starts', () => {
    const sparsePath = [
      { lat: 38.0, lng: -108.0 },
      { lat: 38.2, lng: -108.0 },
      { lat: 38.4, lng: -108.0 },
      { lat: 38.6, lng: -108.0 },
    ];
    const itinerary = buildMultiDayItinerary(sparsePath, 4, undefined, { campsiteStatuses: [] });

    expect(itinerary.days.length).toBe(1);
    expect(itinerary.days[0].campsite).toBeNull();
    expect(itinerary.warnings.join(' ')).toMatch(/partial|will not infer camping/i);
  });

  it('cycle 5: rejects an unverified overnight site that is too far from the mapped route', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        features: [{
          attributes: {
            OBJECTID: 301,
            SITE_NAME: 'Remote Mesa Campground',
            SITE_TYPE: 'CAMPGROUND',
            ACTIVITY_TYPE_LIST: 'CAMPING',
            FEE_CHARGED: 'N',
            WATER_AVAILABILITY: '',
            TOTAL_CAPACITY: 5,
            LATITUDE: 38.1,
            LONGITUDE: -108.025,
            PACK_IN_OUT: 'N',
            OPEN_SEASON: '',
            PERMIT_INFORMATION: '',
            RESTRICTIONS: '',
          },
        }],
      }),
    })) as unknown as typeof fetch;

    try {
      await fetchCampsitesInBBox(38.01, -108.05, 38.21, -107.95);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const path = [
      { lat: 38.0, lng: -108.0 },
      { lat: 38.1, lng: -108.0 },
      { lat: 38.2, lng: -108.0 },
    ];
    const farUnverified = site({
      id: 301,
      name: 'Remote Mesa Campground',
      lat: 38.1,
      lng: -108.025,
      siteType: 'campground',
      activities: ['CAMPING'],
    });
    const statuses = buildCampsiteStatuses([farUnverified], [], alerts(), '2026-06-15T00:00:00Z');
    const itinerary = buildMultiDayItinerary(path, 2, undefined, { campsiteStatuses: statuses });

    expect(itinerary.days[0].campsite).toBeNull();
    expect(itinerary.warnings.join(' ')).toMatch(/No confirmed legal campsite/i);
  });
});
