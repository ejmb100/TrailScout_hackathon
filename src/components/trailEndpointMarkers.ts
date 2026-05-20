import type { TrailData } from '../services/osmService';

export interface TrailEndpointMarkerData {
  lat: number;
  lng: number;
  label: 'Start' | 'End';
  title: string;
  color: string;
  strokeColor: string;
}

function primaryTrails(trails: TrailData[]): TrailData[] {
  const highlighted = trails.filter((trail) => trail.tags.color === '#FF7D0F');
  return highlighted.length > 0 ? highlighted : trails.slice(0, 1);
}

export function buildTrailEndpointMarkers(trails: TrailData[]): TrailEndpointMarkerData[] {
  const markers: TrailEndpointMarkerData[] = [];

  for (const trail of primaryTrails(trails)) {
    if (!trail.path || trail.path.length < 2) continue;
    const start = trail.path[0];
    const end = trail.path[trail.path.length - 1];
    markers.push({
      lat: start.lat,
      lng: start.lng,
      label: 'Start',
      title: `Start: ${trail.name}`,
      color: '#F97316',
      strokeColor: '#22C55E',
    });
    markers.push({
      lat: end.lat,
      lng: end.lng,
      label: 'End',
      title: `End: ${trail.name}`,
      color: '#EF4444',
      strokeColor: '#FFFFFF',
    });
  }

  return markers;
}
