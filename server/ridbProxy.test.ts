import { describe, expect, it } from 'vitest';
import { buildRidbPathWithQuery, normalizeRidbPath } from './ridbProxy';

describe('ridbProxy path allowlist', () => {
  it('defaults to facilities and strips proxy-only params', () => {
    expect(buildRidbPathWithQuery('/api/ridb?latitude=39&path=/facilities&apikey=bad')).toBe(
      '/facilities?latitude=39'
    );
  });

  it('allows facility campsite detail paths', () => {
    expect(buildRidbPathWithQuery('/api/ridb?path=/facilities/123/campsites&limit=50')).toBe(
      '/facilities/123/campsites?limit=50'
    );
  });

  it('rejects unsupported or unsafe paths', () => {
    expect(normalizeRidbPath('/../../secrets')).toBeNull();
    expect(normalizeRidbPath('/unknown')).toBeNull();
    expect(normalizeRidbPath('https://evil.example/facilities')).toBeNull();
  });
});
