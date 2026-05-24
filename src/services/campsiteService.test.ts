import { describe, expect, it } from 'vitest';
import { filterCampsitesNearPath } from './campsiteService';

describe('filterCampsitesNearPath', () => {
  it('keeps campsites within the trail corridor and drops distant bbox noise', () => {
    const path = [
      { lat: 39.0, lng: -106.0 },
      { lat: 39.1, lng: -106.0 },
    ];
    const sites = [
      {
        id: 1,
        name: 'Near Camp',
        lat: 39.05,
        lng: -106.0,
        siteType: 'campground' as const,
        water: null,
        fee: false,
        capacity: null,
        packInOut: false,
        openSeason: '',
        activities: [],
        permits: '',
        restrictions: '',
      },
      {
        id: 2,
        name: 'Far Camp',
        lat: 40.5,
        lng: -104.0,
        siteType: 'campground' as const,
        water: null,
        fee: false,
        capacity: null,
        packInOut: false,
        openSeason: '',
        activities: [],
        permits: '',
        restrictions: '',
      },
    ];

    const filtered = filterCampsitesNearPath(sites, path, 5);
    expect(filtered.map((site) => site.name)).toEqual(['Near Camp']);
  });
});
