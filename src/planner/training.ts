import { effortDifficultyTier, type EffortEstimate, type EffortTier } from './effort';

export type TrainingSessionType =
  | 'easy_hike'
  | 'long_hike'
  | 'hill_repeats'
  | 'strength'
  | 'pack_carry'
  | 'snow_traction'
  | 'mobility'
  | 'recovery';

export interface TrainingSession {
  type: TrainingSessionType;
  title: string;
  target: string;
}

export interface TrainingWeek {
  week: number;
  focus: string;
  sessions: TrainingSession[];
}

export interface TrainingConditionInput {
  dateText?: string;
  regionText?: string;
  conditionText?: string;
}

export interface TrainingConditionModifier {
  multiplier: number;
  factors: string[];
  notes: string[];
}

export interface TrainingProgram {
  effortTier: EffortTier;
  weeksUntilTrip: number;
  weeklyFocus: string[];
  peakTargets: {
    longHikeKm: number;
    climbM: number;
    packWeightKg: number;
  };
  conditionModifier: TrainingConditionModifier;
  sessions: TrainingSession[];
  weeks: TrainingWeek[];
  actionItems: string[];
  disclaimer: string;
}

export interface TrainingProgramInput {
  effort: EffortEstimate;
  distanceKm: number;
  tripDays: number;
  weeksUntilTrip?: number;
  conditions?: TrainingConditionInput;
}

export interface TrainingMarkdownContext {
  tripName?: string;
  totalDistanceKm: number;
  tripDays: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function tierLoad(tier: EffortTier): number {
  switch (tier) {
    case 'Easy': return 0.35;
    case 'Moderate': return 0.50;
    case 'Challenging': return 0.65;
    case 'Difficult': return 0.78;
    case 'Very Difficult': return 0.9;
  }
}

function monthFromText(text: string): number | null {
  const m = text.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (!m) return null;
  const key = m[1].slice(0, 3);
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  return months[key] ?? null;
}

export function buildConditionModifier(conditions?: TrainingConditionInput): TrainingConditionModifier {
  const text = `${conditions?.dateText ?? ''} ${conditions?.regionText ?? ''} ${conditions?.conditionText ?? ''}`.toLowerCase();
  const factors: string[] = [];
  const notes: string[] = [];
  let multiplier = 1;

  const hasAlpine = /alpine|high country|above treeline|pass|ridge|summit|colorado|sierra|cascades|rocky mountain|rockies/.test(text);
  const month = monthFromText(text);
  const shoulderSnowSeason = month != null && hasAlpine && [10, 11, 12, 1, 2, 3, 4, 5, 6].includes(month);

  if (/posthol|soft snow|deep snow|snowshoe/.test(text)) {
    multiplier += 0.4;
    factors.push('soft snow / postholing');
    notes.push('Prepare for materially slower travel in soft snow and practice moving with traction or snowshoes before the trip.');
  } else if (/snow|snowfield|cornice|wintry/.test(text) || shoulderSnowSeason) {
    multiplier += 0.18;
    factors.push('snow likelihood');
    notes.push('Include snow-footing practice and plan a slower pace if snow remains on shaded or high-elevation sections.');
  }

  if (/ice|icy|microspike|crampon|traction|frozen/.test(text)) {
    multiplier += 0.14;
    factors.push('ice / traction');
    notes.push('Practice controlled descents and carry/fit traction such as microspikes when current conditions warrant it.');
  }

  if (/mud|muddy|washout|blowdown/.test(text)) {
    multiplier += 0.08;
    factors.push('rough surface');
    notes.push('Add ankle stability and uneven-footing hikes because rough trail conditions can increase fatigue.');
  }

  if (/altitude|high elevation|thin air|above 10,?000|above 11,?000|above 12,?000|3,?000\s*m|3500\s*m/.test(text)) {
    multiplier += 0.12;
    factors.push('altitude');
    notes.push('Build aerobic margin and consider an acclimatization day for high-elevation routes.');
  }

  multiplier = Math.round(clamp(multiplier, 1, 1.8) * 100) / 100;
  return { multiplier, factors, notes };
}

export function buildTrainingProgram(input: TrainingProgramInput): TrainingProgram {
  const tripDays = Math.max(1, input.tripDays);
  const distanceKm = Math.max(0, input.distanceKm);
  const tier = effortDifficultyTier(input.effort, distanceKm);
  const weeksUntilTrip = clamp(input.weeksUntilTrip ?? 8, 3, 16);
  const load = tierLoad(tier);
  const conditionModifier = buildConditionModifier(input.conditions);
  const conditionScale = conditionModifier.multiplier;
  const dailyKm = tripDays > 0 ? distanceKm / tripDays : distanceKm;
  const dailyAscentM = input.effort.totalAscentM / tripDays;

  const longHikeMultiplier = tier === 'Easy' ? 1.0 : 1.0 + load * 0.5;
  const longHikeKm = roundHalf(clamp(dailyKm * longHikeMultiplier * Math.min(conditionScale, 1.2), 6, Math.max(8, dailyKm * 1.6)));
  const peakClimbBaseM = tripDays > 1 ? Math.max(dailyAscentM, input.effort.totalAscentM * 0.65) : dailyAscentM;
  const climbM = Math.round(clamp(peakClimbBaseM * (0.75 + load * 0.45) * conditionScale, 100, Math.max(150, peakClimbBaseM * 1.5)) / 50) * 50;
  const packWeightKg = roundHalf(clamp(4 + load * 10 + Math.max(0, tripDays - 1) * 1.25, 4, 18));

  const baseSessions: TrainingSession[] = [
    { type: 'easy_hike', title: 'Aerobic base hike/walk', target: 'Zone 2 effort; conversational pace.' },
    { type: 'strength', title: 'Leg and core strength', target: 'Step-ups, split squats, calf raises, hinge, loaded carries.' },
    { type: 'mobility', title: 'Mobility and prehab', target: 'Ankles, hips, calves, hamstrings; 15–25 min.' },
    { type: 'recovery', title: 'Recovery day', target: 'Rest or very easy walk; prioritize sleep and hydration.' },
  ];

  if (tier !== 'Easy') {
    baseSessions.push({ type: 'hill_repeats', title: 'Hill repeats / incline intervals', target: `Accumulate climbing toward ${climbM} m peak week; practice controlled descents.` });
  }
  if (tier === 'Challenging' || tier === 'Difficult' || tier === 'Very Difficult') {
    baseSessions.push({ type: 'pack_carry', title: 'Loaded pack carry', target: `Build gradually toward ${packWeightKg} kg; include descents and uneven footing.` });
  }
  if (conditionModifier.factors.some((factor) => /snow|ice|traction/i.test(factor))) {
    baseSessions.push({
      type: 'snow_traction',
      title: 'Snow / traction footing practice',
      target: 'Practice short hikes or stair descents with poles and traction; emphasize balance, braking, and conservative turnaround decisions.',
    });
  }
  baseSessions.push({ type: 'long_hike', title: 'Progressive long hike', target: `Build toward ~${longHikeKm} km and ~${climbM} m climbing in peak week.` });

  const weeklyFocus = [
    'Base aerobic consistency and joint durability',
    'Climbing strength and descending control',
    conditionModifier.factors.length > 0
      ? `Condition-specific practice: ${conditionModifier.factors.join(', ')}`
      : 'Loaded-pack specificity and foot care',
    'Peak long hike rehearsal, then taper into the trip',
  ];

  const weeks: TrainingWeek[] = Array.from({ length: weeksUntilTrip }, (_, i) => {
    const week = i + 1;
    const progress = week / weeksUntilTrip;
    const isTaper = week === weeksUntilTrip;
    const focus = isTaper
      ? 'Taper: reduce volume, keep legs fresh, check gear.'
      : progress < 0.35
        ? weeklyFocus[0]
        : progress < 0.65
          ? weeklyFocus[1]
          : progress < 0.88
            ? weeklyFocus[2]
            : weeklyFocus[3];
    return {
      week,
      focus,
      sessions: isTaper
        ? baseSessions.filter((s) => ['easy_hike', 'mobility', 'recovery'].includes(s.type))
        : baseSessions,
    };
  });

  const actionItems = [
    `Build to a peak day hike target of ~${longHikeKm} km with ~${climbM} m climbing before the trip. This represents the hardest expected training day, not the full trip distance.`,
    `Practice with a loaded pack up to ~${packWeightKg} kg if you will carry overnight gear.`,
    ...conditionModifier.notes,
  ];

  return {
    effortTier: tier,
    weeksUntilTrip,
    weeklyFocus,
    peakTargets: { longHikeKm, climbM, packWeightKg },
    conditionModifier,
    sessions: baseSessions,
    weeks,
    actionItems,
    disclaimer: 'Training guidance is general fitness information, not medical advice. Consult a medical professional before increasing training load, especially with injury, cardiac, respiratory, or altitude concerns.',
  };
}

function sessionBullet(session: TrainingSession): string {
  return `- **${session.title}:** ${session.target}`;
}

export function trainingProgramToMarkdown(program: TrainingProgram, context: TrainingMarkdownContext): string {
  const title = context.tripName?.trim() || 'Hiking Trip';
  const averageDayKm = context.tripDays > 0 ? context.totalDistanceKm / context.tripDays : context.totalDistanceKm;
  const lines: string[] = [];

  lines.push('# TrailScout Hiking Training Program');
  lines.push('');
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('### Trip Demand Snapshot');
  lines.push(`- **Total route distance:** ~${context.totalDistanceKm.toFixed(1)} km across ${context.tripDays} day${context.tripDays === 1 ? '' : 's'}`);
  lines.push(`- **Average route day:** ~${averageDayKm.toFixed(1)} km/day`);
  lines.push(`- **Effort tier:** ${program.effortTier}`);
  lines.push(`- **Peak day hike target:** ~${program.peakTargets.longHikeKm} km`);
  lines.push(`- **Peak climbing target:** ~${program.peakTargets.climbM} m`);
  lines.push(`- **Loaded-pack target:** up to ~${program.peakTargets.packWeightKg} kg`);
  lines.push('');
  lines.push('The peak day hike target is a training-day benchmark for the hardest expected day. It is not the full trip distance for a multi-day itinerary.');
  lines.push('');

  if (program.conditionModifier.factors.length > 0) {
    lines.push('### Condition Adjustment');
    lines.push(`- **Modifier:** ${program.conditionModifier.multiplier}x`);
    lines.push(`- **Factors:** ${program.conditionModifier.factors.join(', ')}`);
    program.conditionModifier.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push('');
  }

  lines.push('### Weekly Structure');
  lines.push('- **Aerobic base:** easy hikes/walks at conversational effort.');
  lines.push('- **Climbing/descending:** hill repeats, step-down control, and eccentric leg strength.');
  lines.push('- **Strength:** legs, hips, calves, core, and loaded carries.');
  lines.push('- **Specificity:** pack carries, poles, footwear, foot care, and condition-specific practice.');
  lines.push('- **Recovery:** at least one easy/rest day weekly; reduce volume if soreness persists.');
  lines.push('');

  for (const week of program.weeks) {
    lines.push(`## Week ${week.week}`);
    lines.push(`**Focus:** ${week.focus}`);
    lines.push('');
    week.sessions.forEach((session) => lines.push(sessionBullet(session)));
    if (week.week === program.weeks.length) {
      lines.push('- **Taper:** keep movement easy, test gear only briefly, and prioritize sleep before departure.');
    }
    lines.push('');
  }

  lines.push('### Action Items');
  program.actionItems.forEach((item) => lines.push(`- [ ] ${item}`));
  lines.push('- [ ] Confirm current trail, weather, permit, fire, water, and snow/ice conditions before departure.');
  lines.push('- [ ] Stop or reduce training load if pain, illness, or unusual fatigue appears.');
  lines.push('');
  lines.push('### Disclaimer');
  lines.push(program.disclaimer);
  lines.push('');
  lines.push('Generated by TrailScout.');

  return lines.join('\n');
}
