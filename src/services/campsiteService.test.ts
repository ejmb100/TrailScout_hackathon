import { describe, expect, it } from 'vitest';
import { expandPathForCampsiteSearch, filterCampsitesNearPath, nearestCampsitesToPath } from './campsiteService';

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

describe('expandPathForCampsiteSearch', () => {
  it('uses a padded bbox corridor when endpoints are too close for the tagged length', () => {
    const path = [
      { lat: 39.0, lng: -106.0 },
      { lat: 39.01, lng: -106.0 },
    ];
    const expanded = expandPathForCampsiteSearch(path, 30);
    expect(expanded.length).toBe(5);
    expect(expanded[0].lat).toBeLessThan(39.0);
    expect(expanded[2].lat).toBeGreaterThan(39.01);
  });

  it('returns nearest campsites to the expanded corridor when bbox filter would miss them', () => {
    const path = [
      { lat: 39.0, lng: -106.0 },
      { lat: 39.01, lng: -106.0 },
    ];
    const sites = [
      {
        id: 1,
        name: 'Mid-route Camp',
        lat: 39.15,
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

    const nearest = nearestCampsitesToPath(sites, expandPathForCampsiteSearch(path, 30), 1);
    expect(nearest.map((site) => site.name)).toEqual(['Mid-route Camp']);
  });
});
