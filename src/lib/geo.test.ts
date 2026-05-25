import { describe, expect, it } from 'vitest';
import { flattenLineGeometry, haversineKm, lineLengthKm, representativePoint, validateLinePath } from './geo';

describe('geo helpers', () => {
  it('calculates approximate haversine distance and line length', () => {
    const a = { lat: 37.0, lng: -108.0 };
    const b = { lat: 37.01, lng: -108.0 };

    expect(haversineKm(a, b)).toBeGreaterThan(1.0);
    expect(haversineKm(a, b)).toBeLessThan(1.2);
    expect(lineLengthKm([a, b])).toBeCloseTo(haversineKm(a, b), 5);
  });

  it('flattens LineString and returns a representative point', () => {
    const path = flattenLineGeometry({
      type: 'LineString',
      coordinates: [
        [-108.0, 37.0],
        [-108.0, 37.01],
      ],
    });

    expect(path).toEqual([
      { lat: 37.0, lng: -108.0 },
      { lat: 37.01, lng: -108.0 },
    ]);
    expect(representativePoint(path)?.lat).toBeGreaterThan(37.0);
  });

  it('detects empty and sub-2-point line geometry', () => {
    expect(validateLinePath([]).issues).toContain('geometry: empty geometry');
    expect(validateLinePath([{ lat: 37, lng: -108 }]).issues).toContain('geometry: line has fewer than 2 points');
  });
});
