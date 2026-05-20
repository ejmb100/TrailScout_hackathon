/**
 * Recreation.gov RIDB adapter — fetches federal recreation facility data
 * (campgrounds, permit areas) for a bounding box, providing operational
 * status, reservation info, and last-updated timestamps that the USFS EDW
 * baseline does not carry.
 *
 * API docs: https://ridb.recreation.gov/docs
 */

const BASE_URL = 'https://ridb.recreation.gov/api/v1';
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

let cachedFacilities: RidbFacility[] = [];
let cachedBBox = '';

/**
 * Search RIDB for recreation facilities near a bounding box center.
 * RIDB uses radius search (lat/lng + miles), so we derive center + radius
 * from the bbox.
 */
export async function fetchRidbFacilities(
  south: number, west: number, north: number, east: number
): Promise<RidbFacility[]> {
  if (!isRidbConfigured) return [];

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
        apikey: ridbKey,
      });

      const res = await fetch(`${BASE_URL}/facilities?${params}`);
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

export function getRidbFacilities(): RidbFacility[] {
  return cachedFacilities;
}

export function getRidbFacilityCount(): number {
  return cachedFacilities.length;
}
