import { describe, expect, it } from 'vitest';
import { getSourceById, sourceRegistry, validateSourceRegistry } from './registry';

describe('source registry', () => {
  it('has valid metadata for every registered source', () => {
    expect(validateSourceRegistry()).toEqual([]);
    expect(sourceRegistry.length).toBeGreaterThanOrEqual(8);
  });

  it('includes USGS/TNM and excludes proprietary hiking platforms as ingestible sources', () => {
    expect(getSourceById('usgs-tnm-trails').endpoint).toContain('/transportation/MapServer/37');
    expect(sourceRegistry.some((source) => /alltrails|trailforks|gaia|komoot/i.test(source.name))).toBe(false);
  });
});
