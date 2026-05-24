import { describe, expect, it } from 'vitest';
import { normalizeIntentProfile } from './geminiService';

describe('normalizeIntentProfile', () => {
  it('treats a four-day hiking request as backpacking/multi-day with checks required', () => {
    const profile = normalizeIntentProfile(
      {
        location: 'Colorado',
        date: 'July',
        difficulty: 'moderate',
        tripType: 'day_hike',
      },
      'Find a four-day hiking trail in Colorado in July',
    );

    expect(profile.tripType).toBe('multi_day');
    expect(profile.activity).toBe('backpacking');
    expect(profile.tripLengthDays).toBe(4);
    expect(profile.durationDays).toBe(4);
    expect(profile.overnightRequired).toBe(true);
    expect(profile.campsiteSupportRequired).toBe(true);
    expect(profile.permitCheckRequired).toBe(true);
    expect(profile.seasonalityCheckRequired).toBe(true);
    expect(profile.snowRiskCheckRequired).toBe(true);
    expect(profile.accessCheckRequired).toBe(true);
    expect(profile.month).toBe('july');
  });
});
