import type { MultiDayItinerary } from '../planner';
import type { CampsiteStatus } from '../services/campsiteStatusService';
import type { MapMarkerData } from './MapContainer';

function campsiteKey(lat: number, lng: number, name: string): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${name.toLowerCase().trim()}`;
}

/**
 * Build map POIs with itinerary campsites numbered by the night they are used.
 * Only source-backed campsite stops from the itinerary receive night numbers;
 * remaining status POIs are shown as context without a night label.
 */
export function buildTripPoiMarkers(
  itinerary: MultiDayItinerary | undefined,
  campsiteStatuses: CampsiteStatus[] = []
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

  for (const cs of campsiteStatuses) {
    const key = campsiteKey(cs.campsite.lat, cs.campsite.lng, cs.campsite.name);
    if (used.has(key)) continue;
    markers.push({
      lat: cs.campsite.lat,
      lng: cs.campsite.lng,
      name: cs.campsite.name,
      type: cs.campsite.siteType === 'trailhead' ? 'trailhead' : 'campsite',
      status: cs.status,
    });
  }

  return markers;
}
