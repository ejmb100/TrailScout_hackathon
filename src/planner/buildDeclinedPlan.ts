import type { IntentProfile, TripPlan } from '../services/geminiService';
import type { PlannerRecommendation } from './types';

/** When no trail passes deterministic gates — still returns a valid TripPlan for UI continuity. */
export function buildDeclinedTripPlan(intent: IntentProfile, rec: PlannerRecommendation): TripPlan {
  const detail =
    rec.blockingReasons.length > 0
      ? rec.blockingReasons.join(' ')
      : 'No candidate satisfied distance, timing, weather tolerance, and safety checks together.';

  return {
    recommendedTrailId: 0,
    recommendedTrailName: 'No primary recommendation',
    tripType: intent.tripType,
    tripLengthDays: intent.tripLengthDays,
    whyChosen: `TrailScout did not auto-select a trail. ${detail} Review the list for context only — verify everything in the field.`,
    departureTime: '—',
    expectedReturnTime: intent.latestReturnTime || '—',
    estimatedDuration: '—',
    driveTime: '—',
    dailyPlan:
      intent.tripType === 'multi_day'
        ? ['No multi-day plan generated — choose a route that fits your party after verifying conditions.']
        : ['No day plan generated — pick a trail that passes your constraints after local verification.'],
    whatToBring: ['Map/compass or GPS', 'Weather-appropriate layers', 'Extra food and water', 'Headlamp', 'First aid'],
    safetyNotes: [
      ...rec.blockingReasons.slice(0, 4),
      'Do not rely on match scores when hard checks failed — confirm conditions, closures, and your skill level.',
    ],
    logisticsNotes: ['Check land manager websites for permits, closures, and seasonal restrictions.'],
    routeNotes: rec.geometryDisclaimer || 'Mapped OSM lengths are approximate; trails may be longer or shorter than geometry suggests.',
    weatherSummary: 'See regional forecast on the results screen.',
    conditionsSummary: 'Not evaluated for a specific trail — verify locally.',
    backupTrailId: 0,
    backupTrailName: 'None',
    backupReason: 'N/A',
    packingChecklist: ['Water', 'Snacks', 'Rain shell', 'Navigation', 'Headlamp', 'First aid'],
    calendarTitle: 'TrailScout — manual planning needed',
    calendarDescription: detail,
    shareableSummary: `TrailScout: no auto-recommendation for this search. ${detail.slice(0, 200)}`,
  };
}
