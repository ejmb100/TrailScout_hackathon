import type { MultiDayItinerary } from '../planner';
import type { CampsiteStatus } from '../services/campsiteStatusService';
import { filterCampsiteStatusesNearPath } from '../services/campsiteStatusService';
import type { TrailPoint } from '../services/osmService';
import type { MapMarkerData } from './MapContainer';

function campsiteKey(lat: number, lng: number, name: string): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${name.toLowerCase().trim()}`;
}

/**
 * Build map POIs with itinerary campsites numbered by the night they are used.
 * Only selected overnight stops from the itinerary receive campsite markers;
 * trailhead status POIs may remain as navigation context, but non-selected
 * campsite/campground records are intentionally hidden on the focused trip map
 * so the marker count matches the itinerary's mapped camp nights.
 */
export function buildTripPoiMarkers(
  itinerary: MultiDayItinerary | undefined,
  campsiteStatuses: CampsiteStatus[] = [],
  options?: { trailPath?: TrailPoint[] },
): MapMarkerData[] {
  const markers: MapMarkerData[] = [];
  const used = new Set<string>();

  for (const seg of itinerary?.days ?? []) {
    if (!seg.campsite) continue;
    if (!seg.campsiteRecommendation.publicDataBacked || !seg.campsiteRecommendation.officialCampingFacility) continue;
    const key = campsiteKey(seg.campsite.lat, seg.campsite.lng, seg.campsite.name);
    used.add(key);
    markers.push({
      lat: seg.campsite.lat,
      lng: seg.campsite.lng,
      name: `Night ${seg.day}: ${seg.campsite.name}`,
      type: 'campsite',
      status: seg.campsiteStatus ?? (seg.campsiteRecommendation.status === 'not_found' ? undefined : seg.campsiteRecommendation.status),
      night: seg.day,
    });
  }

  const trailPath = options?.trailPath ?? [];
  const routeStatuses = trailPath.length >= 2
    ? filterCampsiteStatusesNearPath(campsiteStatuses, trailPath, 3)
    : campsiteStatuses;

  for (const cs of routeStatuses) {
    if (cs.campsite.siteType === 'trailhead') continue;
    const key = campsiteKey(cs.campsite.lat, cs.campsite.lng, cs.campsite.name);
    if (used.has(key)) continue;
    used.add(key);
    markers.push({
      lat: cs.campsite.lat,
      lng: cs.campsite.lng,
      name: cs.campsite.name,
      type: 'campsite',
      status: cs.status,
    });
  }

  for (const cs of routeStatuses) {
    if (cs.campsite.siteType !== 'trailhead') continue;
    const key = campsiteKey(cs.campsite.lat, cs.campsite.lng, cs.campsite.name);
    if (used.has(key)) continue;
    markers.push({
      lat: cs.campsite.lat,
      lng: cs.campsite.lng,
      name: cs.campsite.name,
      type: 'trailhead',
      status: cs.status,
    });
  }

  return markers;
}
