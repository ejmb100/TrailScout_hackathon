import { describe, expect, it } from 'vitest';
import {
  buildMapTilerStyleUrl,
  buildTerrainDemSource,
  trailToGeoJsonFeatureCollection,
  poiMarkersToGeoJsonFeatureCollection,
} from './mapTilerTerrain';
import type { TrailData } from '../services/osmService';
import type { MapMarkerData } from './MapContainer';

describe('MapTiler 3D terrain configuration', () => {
  it('builds MapTiler style and DEM URLs with the browser key', () => {
    expect(buildMapTilerStyleUrl('abc123', 'outdoor-v2')).toBe(
      'https://api.maptiler.com/maps/outdoor-v2/style.json?key=abc123'
    );

    expect(buildTerrainDemSource('abc123')).toEqual({
      type: 'raster-dem',
      url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=abc123',
      tileSize: 256,
      attribution: 'Terrain RGB tiles © MapTiler',
    });
  });

  it('converts TrailScout route geometry into line GeoJSON preserving route names and colors', () => {
    const trails: TrailData[] = [
      {
        id: 42,
        name: 'Alpine Traverse',
        path: [
          { lat: 39.1, lng: -106.1 },
          { lat: 39.2, lng: -106.2 },
        ],
        tags: { color: '#FF7D0F' },
      },
      {
        id: 43,
        name: 'Too Short',
        path: [{ lat: 39.3, lng: -106.3 }],
        tags: { color: '#03D4BD' },
      },
    ];

    expect(trailToGeoJsonFeatureCollection(trails)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-106.1, 39.1],
              [-106.2, 39.2],
            ],
          },
          properties: {
            id: 42,
            name: 'Alpine Traverse',
            color: '#FF7D0F',
          },
        },
      ],
    });
  });

  it('converts numbered campsite markers into point GeoJSON for terrain overlays', () => {
    const markers: MapMarkerData[] = [
      {
        lat: 39.1,
        lng: -106.1,
        name: 'Night One Camp',
        type: 'campsite',
        status: 'confirmed',
        night: 1,
      },
      {
        lat: 39.2,
        lng: -106.2,
        name: 'Main Trailhead',
        type: 'trailhead',
      },
    ];

    expect(poiMarkersToGeoJsonFeatureCollection(markers)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-106.1, 39.1] },
          properties: {
            name: 'Night One Camp',
            type: 'campsite',
            status: 'confirmed',
            night: 1,
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-106.2, 39.2] },
          properties: {
            name: 'Main Trailhead',
            type: 'trailhead',
            status: undefined,
            night: undefined,
          },
        },
      ],
    });
  });
});
