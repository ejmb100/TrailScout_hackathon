import { describe, expect, it } from 'vitest';
import type { TrailData } from '../services/osmService';
import { buildTrailEndpointMarkers } from './trailEndpointMarkers';

const baseTrail: TrailData = {
  id: 1,
  name: 'Colorado Trail Test Segment',
  path: [
    { lat: 39.0, lng: -106.0 },
    { lat: 39.1, lng: -106.1 },
    { lat: 39.2, lng: -106.2 },
  ],
  tags: { color: '#FF7D0F' },
};

describe('buildTrailEndpointMarkers', () => {
  it('marks the highlighted trail start as green-orange and end as red', () => {
    const markers = buildTrailEndpointMarkers([baseTrail]);

    expect(markers).toEqual([
      {
        lat: 39.0,
        lng: -106.0,
        label: 'Start',
        title: 'Start: Colorado Trail Test Segment',
        color: '#F97316',
        strokeColor: '#22C55E',
      },
      {
        lat: 39.2,
        lng: -106.2,
        label: 'End',
        title: 'End: Colorado Trail Test Segment',
        color: '#EF4444',
        strokeColor: '#FFFFFF',
      },
    ]);
  });
});
