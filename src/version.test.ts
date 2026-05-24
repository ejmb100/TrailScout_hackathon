import { describe, expect, it } from 'vitest';
import { APP_BUILD_LABEL } from './version';

describe('app version label', () => {
  it('exposes the server Gemini build label for visible deployment verification', () => {
    expect(APP_BUILD_LABEL).toBe('server-gemini-v1');
  });
});
