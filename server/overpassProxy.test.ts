import { describe, expect, it } from 'vitest';
import { isOverpassBusyRemark, isValidOverpassJson } from './overpassProxy';

describe('overpassProxy', () => {
  it('detects busy Overpass remarks', () => {
    expect(isOverpassBusyRemark('Server is busy. Try again later.')).toBe(true);
    expect(isOverpassBusyRemark('OK')).toBe(false);
  });

  it('accepts valid Overpass JSON payloads', () => {
    expect(
      isValidOverpassJson(
        JSON.stringify({
          elements: [{ type: 'node', id: 1, lat: 1, lon: 2 }],
        })
      )
    ).toBe(true);
  });

  it('rejects HTML error pages', () => {
    expect(isValidOverpassJson('<html><body>busy</body></html>')).toBe(false);
  });

  it('rejects JSON with busy remark', () => {
    expect(
      isValidOverpassJson(JSON.stringify({ remark: 'Rate limit exceeded' }))
    ).toBe(false);
  });
});
