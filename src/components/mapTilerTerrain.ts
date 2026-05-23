import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { SourceSpecification } from 'maplibre-gl';
import type { TrailData } from '../services/osmService';
import type { MapMarkerData } from './MapContainer';

export type MapTilerStyle = 'outdoor-v2' | 'satellite' | 'topo-v2';

export function buildMapTilerStyleUrl(apiKey: string, style: MapTilerStyle = 'outdoor-v2'): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${encodeURIComponent(apiKey)}`;
}

export function buildTerrainDemSource(apiKey: string): SourceSpecification {
  return {
    type: 'raster-dem',
    url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(apiKey)}`,
    tileSize: 256,
    attribution: 'Terrain RGB tiles © MapTiler',
  };
}

export type TrailLineProperties = {
  id: number;
  name: string;
  color: string;
};

export type PoiMarkerProperties = {
  name: string;
  type: MapMarkerData['type'];
  status: MapMarkerData['status'];
  night: number | undefined;
};

export function trailToGeoJsonFeatureCollection(
  trails: TrailData[]
): FeatureCollection<LineString, TrailLineProperties> {
  const features: Feature<LineString, TrailLineProperties>[] = trails
    .filter((trail) => trail.path.length >= 2)
    .map((trail) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trail.path.map((point) => [point.lng, point.lat]),
      },
      properties: {
        id: trail.id,
        name: trail.name,
        color: trail.tags.color || '#FF7D0F',
      },
    }));

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function poiMarkersToGeoJsonFeatureCollection(
  markers: MapMarkerData[]
): FeatureCollection<Point, PoiMarkerProperties> {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [marker.lng, marker.lat],
      },
      properties: {
        name: marker.name,
        type: marker.type,
        status: marker.status,
        night: marker.night,
      },
    })),
  };
}

export function getMapTilerBrowserKey(): string {
  return (import.meta.env.VITE_MAPTILER_KEY || '').trim();
}
