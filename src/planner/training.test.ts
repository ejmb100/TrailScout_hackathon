import { describe, expect, it } from 'vitest';
import type { EffortEstimate } from './effort';
import { buildTrainingProgram, trainingProgramToMarkdown } from './training';

function effort(over: Partial<EffortEstimate> = {}): EffortEstimate {
  return {
    adjustedTimeHours: 12,
    timeRangeHours: [10, 14],
    flatTimeHours: 9,
    totalAscentM: 1400,
    totalDescentM: 1200,
    maxGradePercent: 18,
    avgGradePercent: 11,
    gradeProfile: [],
    assumptions: [],
    ...over,
  };
}

describe('buildTrainingProgram', () => {
  it('creates a climb-focused multi-week plan for difficult high-ascent efforts', () => {
    const program = buildTrainingProgram({
      effort: effort(),
      distanceKm: 48,
      tripDays: 3,
      weeksUntilTrip: 8,
    });

    expect(program.effortTier).toBe('Difficult');
    expect(program.weeks).toHaveLength(8);
    expect(program.weeklyFocus.join(' ')).toMatch(/climb|descending|pack/i);
    expect(program.peakTargets.longHikeKm).toBeGreaterThanOrEqual(22);
    expect(program.peakTargets.climbM).toBeGreaterThanOrEqual(900);
    expect(program.sessions.some((s) => s.type === 'hill_repeats')).toBe(true);
    expect(program.disclaimer).toMatch(/medical/i);
  });

  it('keeps easy lower-ascent trips conservative and shorter', () => {
    const program = buildTrainingProgram({
      effort: effort({
        adjustedTimeHours: 2.6,
        timeRangeHours: [2.2, 3],
        totalAscentM: 180,
        totalDescentM: 180,
        avgGradePercent: 3,
        maxGradePercent: 7,
      }),
      distanceKm: 9,
      tripDays: 1,
      weeksUntilTrip: 4,
    });

    expect(program.effortTier).toBe('Easy');
    expect(program.weeks).toHaveLength(4);
    expect(program.peakTargets.longHikeKm).toBeLessThanOrEqual(10);
    expect(program.sessions.some((s) => s.type === 'recovery')).toBe(true);
  });

  it('adds condition-aware snow and traction training for shoulder-season alpine trips', () => {
    const base = buildTrainingProgram({
      effort: effort(),
      distanceKm: 48,
      tripDays: 3,
      weeksUntilTrip: 8,
    });

    const winterized = buildTrainingProgram({
      effort: effort(),
      distanceKm: 48,
      tripDays: 3,
      weeksUntilTrip: 8,
      conditions: {
        dateText: 'May 20',
        regionText: 'Colorado high country alpine route',
        conditionText: 'Lingering snow and icy passes likely above treeline; microspikes may be needed.',
      },
    });

    expect(winterized.conditionModifier.multiplier).toBeGreaterThan(base.conditionModifier.multiplier);
    expect(winterized.conditionModifier.factors.join(' ')).toMatch(/snow|ice|microspikes|traction/i);
    expect(winterized.peakTargets.climbM).toBeGreaterThan(base.peakTargets.climbM);
    expect(winterized.sessions.some((s) => s.type === 'snow_traction')).toBe(true);
    expect(winterized.actionItems.join(' ')).toMatch(/microspikes|traction|snow/i);
  });

  it('produces a structured downloadable hiking program with weekly workouts and peak day wording', () => {
    const program = buildTrainingProgram({
      effort: effort(),
      distanceKm: 48,
      tripDays: 3,
      weeksUntilTrip: 8,
      conditions: {
        dateText: 'May 20',
        regionText: 'Colorado high country alpine route',
        conditionText: 'Lingering snow and icy passes likely above treeline; microspikes may be needed.',
      },
    });

    const markdown = trainingProgramToMarkdown(program, {
      tripName: 'Colorado Trail Prep',
      totalDistanceKm: 48,
      tripDays: 3,
    });

    expect(markdown).toMatch(/^# TrailScout Hiking Training Program/m);
    expect(markdown).toMatch(/Peak day hike target/i);
    expect(markdown).toMatch(/not the full trip distance/i);
    expect(markdown).toMatch(/## Week 1/i);
    expect(markdown).toMatch(/## Week 8/i);
    expect(markdown).toMatch(/Hill repeats|Loaded pack carry|Snow \/ traction/i);
    expect(markdown).toMatch(/Taper/i);
    expect(markdown).toMatch(/medical/i);
  });
});
