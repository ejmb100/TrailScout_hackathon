import { describe, expect, it, vi } from 'vitest';
import { fetchCampsitesInBBox } from './campsiteService';

describe('fetchCampsitesInBBox', () => {
  it('passes inSR=4326 and normalizes lower-case ArcGIS EDW attributes', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [{
          attributes: {
            objectid: 1475000,
            site_name: 'Test Colorado Campground',
            site_type: 'CAMPGROUND',
            latitude: 39.7,
            longitude: -105.7,
            activity_type_list: 'CAMPING|HIKING',
            fee_charged: 'Y',
            water_availability: 'Drinking water is available',
            total_capacity: 24,
            pack_in_out: 'N',
            open_season: 'June - September',
            permit_information: 'Reservation recommended',
            restrictions: '',
          },
        }],
      }),
    })) as unknown as typeof fetch;
    globalThis.fetch = mockFetch;

    try {
      const sites = await fetchCampsitesInBBox(39.604, -105.796, 39.996, -105.404);
      const requestedUrl = String(vi.mocked(mockFetch).mock.calls[0][0]);
      expect(requestedUrl).toContain('inSR=4326');
      expect(sites).toHaveLength(1);
      expect(sites[0]).toMatchObject({
        name: 'Test Colorado Campground',
        siteType: 'campground',
        lat: 39.7,
        lng: -105.7,
        water: true,
        fee: true,
        capacity: 24,
        activities: ['CAMPING', 'HIKING'],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
