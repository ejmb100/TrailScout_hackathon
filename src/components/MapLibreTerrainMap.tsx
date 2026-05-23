import React, { useEffect, useMemo, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { TrailData } from '../services/osmService';
import type { MapMarkerData } from './MapContainer';
import {
  buildMapTilerStyleUrl,
  buildTerrainDemSource,
  getMapTilerBrowserKey,
  poiMarkersToGeoJsonFeatureCollection,
  trailToGeoJsonFeatureCollection,
} from './mapTilerTerrain';

interface MapLibreTerrainMapProps {
  trails: TrailData[];
  center: { lat: number; lng: number };
  zoom: number;
  poiMarkers: MapMarkerData[];
  /** Changes when the parent map shell expands/collapses, so MapLibre can recompute canvas size. */
  resizeSignal?: boolean;
}

function boundsForTrailsAndMarkers(
  trails: TrailData[],
  markers: MapMarkerData[],
  fallback: { lat: number; lng: number }
): LngLatBoundsLike {
  const bounds = new maplibregl.LngLatBounds();
  let hasPoint = false;

  for (const trail of trails) {
    for (const point of trail.path) {
      bounds.extend([point.lng, point.lat]);
      hasPoint = true;
    }
  }

  for (const marker of markers) {
    bounds.extend([marker.lng, marker.lat]);
    hasPoint = true;
  }

  if (!hasPoint) {
    bounds.extend([fallback.lng, fallback.lat]);
  }

  return bounds;
}

const MapLibreTerrainMap: React.FC<MapLibreTerrainMapProps> = ({ trails, center, zoom, poiMarkers, resizeSignal }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapTilerKey = getMapTilerBrowserKey();

  const routeGeoJson = useMemo(() => trailToGeoJsonFeatureCollection(trails), [trails]);
  const poiGeoJson = useMemo(() => poiMarkersToGeoJsonFeatureCollection(poiMarkers), [poiMarkers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapTilerKey) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapTilerStyleUrl(mapTilerKey, 'outdoor-v2'),
      center: [center.lng, center.lat],
      zoom: Math.max(zoom - 1, 8),
      pitch: 67,
      bearing: -25,
      maxPitch: 85,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    map.on('load', () => {
      if (!map.getSource('terrain-dem')) {
        map.addSource('terrain-dem', buildTerrainDemSource(mapTilerKey));
      }
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.25 });

      map.addSource('trailscout-routes', {
        type: 'geojson',
        data: routeGeoJson,
      });
      map.addLayer({
        id: 'trailscout-route-shadow',
        type: 'line',
        source: 'trailscout-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#0B1020',
          'line-width': 8,
          'line-opacity': 0.72,
        },
      });
      map.addLayer({
        id: 'trailscout-route',
        type: 'line',
        source: 'trailscout-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#FF7D0F'],
          'line-width': 4,
          'line-opacity': 0.96,
        },
      });

      map.addSource('trailscout-pois', {
        type: 'geojson',
        data: poiGeoJson,
      });
      map.addLayer({
        id: 'trailscout-poi-circles',
        type: 'circle',
        source: 'trailscout-pois',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'type'], 'campsite'], 10, 7],
          'circle-color': ['case', ['==', ['get', 'type'], 'campsite'], '#22C55E', '#A78BFA'],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'trailscout-poi-labels',
        type: 'symbol',
        source: 'trailscout-pois',
        layout: {
          'text-field': [
            'case',
            ['has', 'night'],
            ['to-string', ['get', 'night']],
            ['case', ['==', ['get', 'type'], 'trailhead'], 'TH', ''],
          ],
          'text-size': 11,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#0B1020',
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1,
        },
      });

      const bounds = boundsForTrailsAndMarkers(trails, poiMarkers, center);
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, pitch: 67, bearing: -25, duration: 0 });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center, mapTilerKey, poiGeoJson, routeGeoJson, trails, poiMarkers, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const routeSource = map.getSource('trailscout-routes') as GeoJSONSource | undefined;
    routeSource?.setData(routeGeoJson);

    const poiSource = map.getSource('trailscout-pois') as GeoJSONSource | undefined;
    poiSource?.setData(poiGeoJson);

    const bounds = boundsForTrailsAndMarkers(trails, poiMarkers, center);
    map.fitBounds(bounds, { padding: 80, maxZoom: 14, pitch: 67, bearing: -25, duration: 600 });
  }, [center, poiGeoJson, poiMarkers, routeGeoJson, trails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    window.setTimeout(() => map.resize(), 0);
  }, [resizeSignal]);

  if (!mapTilerKey) {
    return (
      <div className="w-full h-full bg-navy flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <div className="text-orange text-xs font-bold uppercase tracking-[0.25em] mb-2">3D terrain unavailable</div>
          <p className="text-offwhite/70 text-sm leading-relaxed">
            Add <code className="bg-white/10 px-1.5 py-0.5 rounded">VITE_MAPTILER_KEY</code> to your local .env file to load MapTiler terrain tiles.
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" aria-label="MapLibre 3D terrain map" />;
};

export default MapLibreTerrainMap;
