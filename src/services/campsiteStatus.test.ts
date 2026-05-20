import { describe, expect, it } from 'vitest';
import {
  buildCampsiteStatuses,
  isBlocked,
  isConditional,
  statusLabel,
  type CampsiteStatus,
} from './campsiteStatusService';
import type { Campsite } from './campsiteService';
import type { RidbFacility } from './recreationGovService';
import type { ForestAlerts } from './forestAlertService';

function makeSite(overrides: Partial<Campsite> = {}): Campsite {
  return {
    id: 1,
    name: 'Test Campground',
    lat: 37.5,
    lng: -107.5,
    siteType: 'campground',
    water: true,
    fee: true,
    capacity: 20,
    packInOut: false,
    openSeason: '',
    activities: ['camping'],
    permits: '',
    restrictions: '',
    ...overrides,
  };
}

function makeRidb(overrides: Partial<RidbFacility> = {}): RidbFacility {
  return {
    facilityId: '12345',
    name: 'Test Campground',
    lat: 37.5,
    lng: -107.5,
    type: 'campground',
    enabled: true,
    reservable: true,
    description: '',
    stayLimit: '',
    lastUpdated: '2026-03-01',
    reservationUrl: '',
    parentOrgId: '131',
    ...overrides,
  };
}

function makeAlerts(overrides: Partial<ForestAlerts> = {}): ForestAlerts {
  return {
    perimeters: [],
    incidents: [],
    fetchedAt: '2026-03-21T00:00:00Z',
    hasActiveFiresInArea: false,
    ...overrides,
  };
}

const NOW = '2026-03-21T00:00:00Z';

describe('buildCampsiteStatuses', () => {
  it('returns confirmed when RIDB match is enabled and reservable', () => {
    const site = makeSite();
    const ridb = makeRidb({ lat: 37.5001, lng: -107.5001 });
    const result = buildCampsiteStatuses([site], [ridb], makeAlerts(), NOW);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('confirmed');
    expect(result[0].confidence).toBeGreaterThanOrEqual(80);
    expect(result[0].ridbMatch).not.toBeNull();
    expect(result[0].sources.length).toBeGreaterThanOrEqual(2);
  });

  it('returns walk_in when RIDB match is enabled but not reservable', () => {
    const site = makeSite();
    const ridb = makeRidb({ reservable: false, lat: 37.5001, lng: -107.5001 });
    const result = buildCampsiteStatuses([site], [ridb], makeAlerts(), NOW);

    expect(result[0].status).toBe('walk_in');
    expect(result[0].warnings.some(w => w.includes('walk-in'))).toBe(true);
  });

  it('returns closed when RIDB match is disabled', () => {
    const site = makeSite();
    const ridb = makeRidb({ enabled: false, lat: 37.5001, lng: -107.5001 });
    const result = buildCampsiteStatuses([site], [ridb], makeAlerts(), NOW);

    expect(result[0].status).toBe('closed');
    expect(isBlocked(result[0].status)).toBe(true);
  });

  it('returns fire_blocked when active fire is nearby', () => {
    const site = makeSite();
    const alerts = makeAlerts({
      hasActiveFiresInArea: true,
      incidents: [{
        id: 1,
        name: 'Test Fire',
        lat: 37.505,
        lng: -107.505,
        acres: 500,
        containment: 20,
        cause: 'Lightning',
        discoveredDate: '2026-03-20T00:00:00Z',
        updatedDate: '2026-03-21T00:00:00Z',
        isActive: true,
      }],
    });
    const result = buildCampsiteStatuses([site], [], alerts, NOW);

    expect(result[0].status).toBe('fire_blocked');
    expect(isBlocked(result[0].status)).toBe(true);
    expect(result[0].nearbyFire).not.toBeNull();
    expect(result[0].warnings.some(w => w.includes('Test Fire'))).toBe(true);
  });

  it('returns unverified when no RIDB match exists', () => {
    const site = makeSite();
    const result = buildCampsiteStatuses([site], [], makeAlerts(), NOW);

    expect(result[0].status).toBe('unverified');
    expect(isConditional(result[0].status)).toBe(true);
    expect(result[0].confidence).toBeLessThan(50);
    expect(result[0].ridbMatch).toBeNull();
  });

  it('does not match RIDB facility beyond the proximity radius', () => {
    const site = makeSite({ lat: 37.5, lng: -107.5 });
    const ridb = makeRidb({ lat: 38.0, lng: -107.0 });
    const result = buildCampsiteStatuses([site], [ridb], makeAlerts(), NOW);

    expect(result[0].status).toBe('unverified');
    expect(result[0].ridbMatch).toBeNull();
  });

  it('fire takes precedence over RIDB closed status', () => {
    const site = makeSite();
    const ridb = makeRidb({ enabled: false, lat: 37.5001, lng: -107.5001 });
    const alerts = makeAlerts({
      hasActiveFiresInArea: true,
      incidents: [{
        id: 1, name: 'Fire', lat: 37.505, lng: -107.505,
        acres: 100, containment: null, cause: '', discoveredDate: '',
        updatedDate: '', isActive: true,
      }],
    });
    const result = buildCampsiteStatuses([site], [ridb], alerts, NOW);

    expect(result[0].status).toBe('fire_blocked');
  });
});

describe('gating helpers', () => {
  it('isBlocked returns true for fire_blocked and closed', () => {
    expect(isBlocked('fire_blocked')).toBe(true);
    expect(isBlocked('closed')).toBe(true);
    expect(isBlocked('confirmed')).toBe(false);
    expect(isBlocked('walk_in')).toBe(false);
    expect(isBlocked('unverified')).toBe(false);
  });

  it('isConditional returns true for unverified, seasonal_closure, walk_in', () => {
    expect(isConditional('unverified')).toBe(true);
    expect(isConditional('seasonal_closure')).toBe(true);
    expect(isConditional('walk_in')).toBe(true);
    expect(isConditional('confirmed')).toBe(false);
    expect(isConditional('fire_blocked')).toBe(false);
  });

  it('statusLabel returns human-readable labels', () => {
    expect(statusLabel('confirmed')).toBe('Confirmed');
    expect(statusLabel('fire_blocked')).toBe('Fire Closure');
    expect(statusLabel('walk_in')).toBe('Walk-in Only');
  });
});
