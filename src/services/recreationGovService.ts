/**
 * Recreation.gov RIDB adapter — fetches federal recreation facility data
 * (campgrounds, permit areas) for a bounding box, providing operational
 * status, reservation info, and last-updated timestamps that the USFS EDW
 * baseline does not carry.
 *
 * API docs: https://ridb.recreation.gov/docs
 */

const BASE_URL = '/api/ridb';
const ridbKey = (typeof __TRAILSCOUT_RIDB_KEY__ !== 'undefined' ? __TRAILSCOUT_RIDB_KEY__ : '').trim();

export const isRidbConfigured = ridbKey.length > 0;

export interface RidbFacility {
  facilityId: string;
  name: string;
  lat: number;
  lng: number;
  type: 'campground' | 'permit_area' | 'other';
  enabled: boolean;
  reservable: boolean;
  description: string;
  stayLimit: string;
  lastUpdated: string;
  reservationUrl: string;
  parentOrgId: string;
}

export interface RidbCampsite {
  campsiteId: string;
  facilityId: string;
  name: string;
  type: string;
  loop: string;
  useType: string;
  accessible: boolean;
  reservable: boolean;
  lastUpdated: string;
}

const FACILITY_TYPE_MAP: Record<string, RidbFacility['type']> = {
  Campground: 'campground',
  'Permit Area': 'permit_area',
};

function normType(raw: string): RidbFacility['type'] {
  return FACILITY_TYPE_MAP[raw] ?? 'other';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function ridbUrl(path: string, params?: URLSearchParams): string {
  const query = new URLSearchParams(params);
  query.set('path', path);
  return `${BASE_URL}?${query}`;
}

let cachedFacilities: RidbFacility[] = [];
let cachedBBox = '';
const cachedFacilityCampsites = new Map<string, RidbCampsite[]>();

/**
 * Search RIDB for recreation facilities near a bounding box center.
 * RIDB uses radius search (lat/lng + miles), so we derive center + radius
 * from the bbox.
 */
export async function fetchRidbFacilities(
  south: number, west: number, north: number, east: number
): Promise<RidbFacility[]> {
  const bboxKey = `${south},${west},${north},${east}`;
  if (bboxKey === cachedBBox && cachedFacilities.length > 0) return cachedFacilities;

  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;

  const latSpanMiles = (north - south) * 69;
  const lngSpanMiles = (east - west) * 69 * Math.cos(centerLat * Math.PI / 180);
  const radiusMiles = Math.min(Math.ceil(Math.max(latSpanMiles, lngSpanMiles) / 2 * 1.2), 100);

  const facilities: RidbFacility[] = [];

  try {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        latitude: String(centerLat),
        longitude: String(centerLng),
        radius: String(radiusMiles),
        limit: '50',
        offset: String(offset),
      });

      const res = await fetch(ridbUrl('/facilities', params));
      if (!res.ok) throw new Error(`RIDB HTTP ${res.status}`);
      const data = await res.json();
      const items: unknown[] = data.RECDATA ?? [];

      for (const raw of items) {
        const f = raw as Record<string, unknown>;
        const lat = Number(f.FacilityLatitude);
        const lng = Number(f.FacilityLongitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;

        facilities.push({
          facilityId: String(f.FacilityID ?? ''),
          name: String(f.FacilityName ?? '').trim(),
          lat,
          lng,
          type: normType(String(f.FacilityTypeDescription ?? '')),
          enabled: f.Enabled === true,
          reservable: f.Reservable === true,
          description: stripHtml(String(f.FacilityDescription ?? '')),
          stayLimit: String(f.StayLimit ?? '').trim(),
          lastUpdated: String(f.LastUpdatedDate ?? ''),
          reservationUrl: String(f.FacilityReservationURL ?? '').trim(),
          parentOrgId: String(f.ParentOrgID ?? ''),
        });
      }

      const totalCount = data.METADATA?.RESULTS?.TOTAL_COUNT ?? 0;
      offset += items.length;
      hasMore = items.length > 0 && offset < totalCount;
    }

    cachedFacilities = facilities;
    cachedBBox = bboxKey;
    console.info(`[RIDB] fetched ${facilities.length} facilities for bbox [${south},${west},${north},${east}]`);
  } catch (err) {
    console.warn('[RIDB] fetch failed, continuing without Recreation.gov data:', err);
  }

  return facilities;
}

function boolish(value: unknown): boolean {
  return value === true || value === 'true' || value === 'Y' || value === 'Yes' || value === '1' || value === 1;
}

export async function fetchRidbCampsitesForFacility(facilityId: string): Promise<RidbCampsite[]> {
  const id = facilityId.trim();
  if (!id) return [];
  const cached = cachedFacilityCampsites.get(id);
  if (cached) return cached;

  const campsites: RidbCampsite[] = [];

  try {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        limit: '50',
        offset: String(offset),
      });

      const res = await fetch(ridbUrl(`/facilities/${encodeURIComponent(id)}/campsites`, params));
      if (!res.ok) throw new Error(`RIDB facility campsites HTTP ${res.status}`);
      const data = await res.json();
      const items: unknown[] = data.RECDATA ?? [];

      for (const raw of items) {
        const c = raw as Record<string, unknown>;
        campsites.push({
          campsiteId: String(c.CampsiteID ?? ''),
          facilityId: String(c.FacilityID ?? id),
          name: String(c.CampsiteName ?? '').trim(),
          type: String(c.CampsiteType ?? '').trim(),
          loop: String(c.Loop ?? '').trim(),
          useType: String(c.TypeOfUse ?? '').trim(),
          accessible: boolish(c.CampsiteAccessible),
          reservable: boolish(c.CampsiteReservable ?? c.Reservable),
          lastUpdated: String(c.LastUpdatedDate ?? ''),
        });
      }

      const totalCount = data.METADATA?.RESULTS?.TOTAL_COUNT ?? 0;
      offset += items.length;
      hasMore = items.length > 0 && offset < totalCount;
    }

    cachedFacilityCampsites.set(id, campsites);
    console.info(`[RIDB] fetched ${campsites.length} campsites for facility ${id}`);
  } catch (err) {
    console.warn(`[RIDB] facility ${id} campsites fetch failed, continuing without campsite-level data:`, err);
  }

  return campsites;
}

export function getRidbFacilities(): RidbFacility[] {
  return cachedFacilities;
}

export function getRidbFacilityCount(): number {
  return cachedFacilities.length;
}
