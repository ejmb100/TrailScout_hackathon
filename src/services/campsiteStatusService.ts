/**
 * Campsite status fusion layer — merges USFS EDW baseline data with
 * Recreation.gov (RIDB) operational status and NIFC fire alerts into
 * a single confidence-scored status per campsite.
 *
 * Precedence rules:
 *   1. Fire perimeter overlap  → BLOCKED (hard)
 *   2. RIDB enabled=false      → CLOSED  (hard)
 *   3. RIDB reservable=false + EDW fee  → WALK_IN (soft info)
 *   4. EDW only, no RIDB match → UNVERIFIED (lower confidence)
 *   5. All sources agree open  → CONFIRMED
 */

import type { Campsite, TrailCampsite } from './campsiteService';
import { filterCampsitesNearPath, nearestCampsitesToPath, type Campsite } from './campsiteService';
import type { TrailPoint } from './osmService';
import type { RidbFacility } from './recreationGovService';
import type { ForestAlerts, FireIncident } from './forestAlertService';

// ─── Types ─────────────────────────────────────────────────────────────

export type CampsiteOperationalStatus =
  | 'confirmed'
  | 'walk_in'
  | 'unverified'
  | 'seasonal_closure'
  | 'closed'
  | 'fire_blocked';

export interface CampsiteStatus {
  /** Original EDW campsite. */
  campsite: Campsite;
  status: CampsiteOperationalStatus;
  /** 0–100, higher is more trustworthy. */
  confidence: number;
  sources: CampsiteSource[];
  warnings: string[];
  /** When each source was last fetched or updated. */
  lastVerified: string;
  ridbMatch: RidbFacility | null;
  nearbyFire: FireIncident | null;
}

export interface CampsiteSource {
  name: 'USFS EDW' | 'Recreation.gov' | 'NIFC Fire' | 'Forest Order';
  fetchedAt: string;
  contributes: string;
}

export interface TrailCampsiteStatus extends CampsiteStatus {
  trailKm: number;
  offsetKm: number;
}

// ─── Proximity matching ────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const R_KM = 6371;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return R_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Max distance (km) for matching a RIDB facility to an EDW campsite. */
const RIDB_MATCH_RADIUS_KM = 2.0;
/** Max distance (km) for flagging a fire incident near a campsite. */
const FIRE_PROXIMITY_KM = 8.0;

function nameTokens(name: string): Set<string> {
  const stop = new Set(['the', 'and', 'at', 'of', 'area', 'site', 'camp', 'campground', 'cg', 'rv']);
  return new Set(
    name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !stop.has(t))
  );
}

function namesLikelySame(a: string, b: string): boolean {
  const at = nameTokens(a);
  const bt = nameTokens(b);
  if (at.size === 0 || bt.size === 0) return false;
  let shared = 0;
  at.forEach(t => { if (bt.has(t)) shared++; });
  return shared >= 1;
}

function findClosestRidb(
  site: Campsite,
  facilities: RidbFacility[]
): RidbFacility | null {
  let best: RidbFacility | null = null;
  let bestDist = RIDB_MATCH_RADIUS_KM;

  for (const f of facilities) {
    if (f.type !== 'campground') continue;
    const d = haversineKm(site, { lat: f.lat, lng: f.lng });
    if (d >= bestDist) continue;
    // Avoid confirming the wrong facility when multiple Colorado campgrounds sit close together.
    // A near-exact coordinate match is accepted; otherwise require a shared distinctive name token.
    if (d > 0.25 && !namesLikelySame(site.name, f.name)) continue;
    bestDist = d;
    best = f;
  }
  return best;
}

function findNearbyFire(
  site: Campsite,
  alerts: ForestAlerts
): FireIncident | null {
  let closest: FireIncident | null = null;
  let closestDist = FIRE_PROXIMITY_KM;

  for (const inc of alerts.incidents) {
    if (!inc.isActive) continue;
    const d = haversineKm(site, { lat: inc.lat, lng: inc.lng });
    if (d < closestDist) {
      closestDist = d;
      closest = inc;
    }
  }
  return closest;
}

// ─── Fusion ────────────────────────────────────────────────────────────

export function buildCampsiteStatuses(
  edwSites: Campsite[],
  ridbFacilities: RidbFacility[],
  alerts: ForestAlerts | null,
  fetchedAt: string,
): CampsiteStatus[] {
  return edwSites.map(site => assessSite(site, ridbFacilities, alerts, fetchedAt));
}

export function filterCampsiteStatusesNearPath(
  statuses: CampsiteStatus[],
  path: TrailPoint[],
  maxOffsetKm = 5,
): CampsiteStatus[] {
  if (path.length < 2 || statuses.length === 0) return statuses;
  const nearIds = new Set(
    filterCampsitesNearPath(
      statuses.map((status) => status.campsite),
      path,
      maxOffsetKm,
    ).map((site) => site.id),
  );
  return statuses.filter((status) => nearIds.has(status.campsite.id));
}

/** Widen corridor until markers appear so the map is not empty near short sampled geometry. */
export function filterCampsiteStatusesNearPathWithFallback(
  statuses: CampsiteStatus[],
  path: TrailPoint[],
  maxOffsetKm = 5,
  maxResults = 40,
): CampsiteStatus[] {
  if (path.length < 2 || statuses.length === 0) {
    return statuses.slice(0, maxResults);
  }

  for (const radius of [maxOffsetKm, maxOffsetKm * 2, maxOffsetKm * 4, maxOffsetKm * 8]) {
    const filtered = filterCampsiteStatusesNearPath(statuses, path, radius);
    if (filtered.length > 0) return filtered.slice(0, maxResults);
  }

  const nearestIds = new Set(
    nearestCampsitesToPath(
      statuses.map((status) => status.campsite),
      path,
      maxResults,
    ).map((site) => site.id),
  );

  return statuses.filter((status) => nearestIds.has(status.campsite.id));
}

function monthFromName(raw: string): number | null {
  const m = raw.toLowerCase().slice(0, 3);
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return months[m] ?? null;
}

function seasonMonths(openSeason: string): { start: number; end: number } | null {
  const matches = openSeason.match(/jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/gi) ?? [];
  const months = matches.map(monthFromName).filter((m): m is number => m != null);
  if (months.length < 2) return null;
  return { start: months[0], end: months[months.length - 1] };
}

function monthInSeason(month: number, season: { start: number; end: number }): boolean {
  if (season.start <= season.end) return month >= season.start && month <= season.end;
  return month >= season.start || month <= season.end;
}

function isOutsideOpenSeason(openSeason: string, isoDate: string): boolean {
  const season = seasonMonths(openSeason);
  if (!season) return false;
  const month = new Date(isoDate).getUTCMonth() + 1;
  return !monthInSeason(month, season);
}

function assessSite(
  site: Campsite,
  ridbFacilities: RidbFacility[],
  alerts: ForestAlerts | null,
  fetchedAt: string,
): CampsiteStatus {
  const sources: CampsiteSource[] = [
    { name: 'USFS EDW', fetchedAt, contributes: 'geolocation, site type, water, fees' },
  ];
  const warnings: string[] = [];

  const ridb = findClosestRidb(site, ridbFacilities);
  if (ridb) {
    sources.push({
      name: 'Recreation.gov',
      fetchedAt: ridb.lastUpdated || fetchedAt,
      contributes: 'operational status, reservability, stay limits',
    });
  }

  const fire = alerts ? findNearbyFire(site, alerts) : null;
  if (alerts) {
    sources.push({
      name: 'NIFC Fire',
      fetchedAt: alerts.fetchedAt,
      contributes: fire ? `active fire: ${fire.name}` : 'no active fires nearby',
    });
  }

  // Precedence 1: fire
  if (fire) {
    const dist = haversineKm(site, { lat: fire.lat, lng: fire.lng });
    warnings.push(
      `Active fire "${fire.name}" (~${Math.round(dist)} km away, ${fire.acres.toLocaleString()} acres, ` +
      `${fire.containment != null ? fire.containment + '% contained' : 'containment unknown'}). ` +
      `Check fs.usda.gov for current closure orders.`
    );
    return {
      campsite: site,
      status: 'fire_blocked',
      confidence: 95,
      sources,
      warnings,
      lastVerified: alerts!.fetchedAt,
      ridbMatch: ridb,
      nearbyFire: fire,
    };
  }

  // Precedence 2: RIDB disabled
  if (ridb && !ridb.enabled) {
    warnings.push(
      `Recreation.gov reports this facility as disabled/closed (last updated ${ridb.lastUpdated}).`
    );
    return {
      campsite: site,
      status: 'closed',
      confidence: 90,
      sources,
      warnings,
      lastVerified: ridb.lastUpdated || fetchedAt,
      ridbMatch: ridb,
      nearbyFire: null,
    };
  }

  // Precedence 3: RIDB match exists → confirmed or walk_in
  if (ridb) {
    const status: CampsiteOperationalStatus = ridb.reservable ? 'confirmed' : 'walk_in';
    const confidence = 85;

    if (!ridb.reservable && site.fee) {
      warnings.push('This site charges a fee but is not reservable online — walk-in/first-come only.');
    }
    if (ridb.stayLimit) {
      warnings.push(`Stay limit: ${ridb.stayLimit}.`);
    }

    return {
      campsite: site,
      status,
      confidence,
      sources,
      warnings,
      lastVerified: ridb.lastUpdated || fetchedAt,
      ridbMatch: ridb,
      nearbyFire: null,
    };
  }

  // Precedence 4: EDW only
  if (site.openSeason && isOutsideOpenSeason(site.openSeason, fetchedAt)) {
    warnings.push(`Seasonal closure likely — ${site.name} open season is "${site.openSeason}", which does not include the requested/planning date. Verify with the managing agency before relying on it.`);
    return {
      campsite: site,
      status: 'seasonal_closure',
      confidence: 75,
      sources,
      warnings,
      lastVerified: fetchedAt,
      ridbMatch: null,
      nearbyFire: null,
    };
  }

  // Precedence 4: EDW only
  if (site.openSeason) {
    const seasonLower = site.openSeason.toLowerCase();
    const isSeasonal = seasonLower.includes('seasonal') ||
      seasonLower.includes('may') || seasonLower.includes('june') ||
      seasonLower.includes('sept') || seasonLower.includes('oct');
    if (isSeasonal) {
      warnings.push(`Seasonal site — EDW reports open season: "${site.openSeason}". Verify current status.`);
    }
  }

  warnings.push('No Recreation.gov match found — operational status not independently verified.');

  return {
    campsite: site,
    status: 'unverified',
    confidence: 45,
    sources,
    warnings,
    lastVerified: fetchedAt,
    ridbMatch: null,
    nearbyFire: null,
  };
}

// ─── Trail-snapped enrichment ──────────────────────────────────────────

/**
 * Enrich TrailCampsite[] (already snapped to a trail) with operational
 * status from the fusion layer. Maintains trail-km ordering.
 */
export function enrichTrailCampsites(
  trailCampsites: TrailCampsite[],
  statuses: CampsiteStatus[],
): TrailCampsiteStatus[] {
  const statusById = new Map(statuses.map(s => [s.campsite.id, s]));

  return trailCampsites.map(tc => {
    const status = statusById.get(tc.id);
    if (status) {
      return { ...status, trailKm: tc.trailKm, offsetKm: tc.offsetKm };
    }
    return {
      campsite: tc,
      status: 'unverified' as const,
      confidence: 30,
      sources: [{ name: 'USFS EDW' as const, fetchedAt: new Date().toISOString(), contributes: 'geolocation only' }],
      warnings: ['Status not assessed — site may not be in current search area.'],
      lastVerified: new Date().toISOString(),
      ridbMatch: null,
      nearbyFire: null,
      trailKm: tc.trailKm,
      offsetKm: tc.offsetKm,
    };
  });
}

// ─── Gating helpers ────────────────────────────────────────────────────

/** Hard blocks: status prevents recommending this as an overnight stop. */
export function isBlocked(status: CampsiteOperationalStatus): boolean {
  return status === 'fire_blocked' || status === 'closed';
}

/** Soft downgrades: recommend with warning. */
export function isConditional(status: CampsiteOperationalStatus): boolean {
  return status === 'unverified' || status === 'seasonal_closure' || status === 'walk_in';
}

export function statusLabel(status: CampsiteOperationalStatus): string {
  switch (status) {
    case 'confirmed': return 'Confirmed';
    case 'walk_in': return 'Walk-in Only';
    case 'unverified': return 'Unverified';
    case 'seasonal_closure': return 'Seasonal Closure';
    case 'closed': return 'Closed';
    case 'fire_blocked': return 'Fire Closure';
  }
}

export function statusColor(status: CampsiteOperationalStatus): string {
  switch (status) {
    case 'confirmed': return 'emerald';
    case 'walk_in': return 'sky';
    case 'unverified': return 'amber';
    case 'seasonal_closure': return 'amber';
    case 'closed': return 'red';
    case 'fire_blocked': return 'red';
  }
}
