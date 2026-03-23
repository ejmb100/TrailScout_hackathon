import type { IntentProfile } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import type { HikeForecast } from '../services/weatherService';
import type { TrailSafetyResult, TripRiskTier } from './types';

/** Rough season hint from intent date + free text (not authoritative). */
export function inferWinterAlpineInterest(intent: IntentProfile, userQuery?: string): boolean {
  const blob = `${intent.date} ${intent.location} ${intent.reasoning} ${userQuery || ''}`.toLowerCase();
  if (/\b(winter|snow|ice|alpine|avalanche|crampon|microspike)\b/.test(blob)) return true;
  return false;
}

function sacSeverity(sac: string | undefined): number {
  if (!sac) return 0;
  const s = sac.toLowerCase();
  if (s.includes('t6') || s.includes('difficult_alpine')) return 6;
  if (s.includes('t5') || s.includes('demanding_alpine')) return 5;
  if (s.includes('t4') || s.includes('alpine_hiking') || s.includes('demanding_mountain')) return 4;
  if (s.includes('t3')) return 3;
  if (s.includes('t2') || s.includes('mountain_hiking')) return 2;
  if (s.includes('t1') || s === 'hiking') return 1;
  return 0;
}

function maxSacForIntent(difficulty: IntentProfile['difficulty']): number {
  switch (difficulty) {
    case 'easy':
      return 2;
    case 'moderate':
      return 3;
    case 'hard':
      return 5;
    case 'expert':
      return 6;
    default:
      return 3;
  }
}

function tierRank(t: TripRiskTier): number {
  switch (t) {
    case 'standard':
      return 0;
    case 'elevated':
      return 1;
    case 'high':
      return 2;
    case 'extreme':
      return 3;
    default:
      return 0;
  }
}

export function worseTier(a: TripRiskTier, b: TripRiskTier): TripRiskTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * Deterministic safety / risk signals from tags, intent, and forecast.
 * LLM narrative does not override blocking findings here.
 */
export function assessSafety(
  intent: IntentProfile,
  trail: TrailData,
  forecast: HikeForecast | null,
  userQuery?: string
): TrailSafetyResult {
  const blockingFindings: string[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  let tier: TripRiskTier = 'standard';

  const tags = trail.tags;
  const sac = tags.sac_scale;
  const sev = sacSeverity(sac);
  const maxSev = maxSacForIntent(intent.difficulty);

  const isUsfs = (tags.trailscout_source ?? '').includes('usfs_nfs');

  if (sac && sev > maxSev) {
    blockingFindings.push(
      `Trail SAC scale (${sac.replace(/_/g, ' ')}) exceeds what we allow for a ${intent.difficulty} intent.`
    );
  } else if (!sac && !isUsfs) {
    assumptions.push('No SAC scale in OSM — difficulty was not verified from mapped tags.');
  } else if (!sac && isUsfs) {
    assumptions.push('USFS trail — no SAC scale available. Difficulty inferred from trail class if present.');
  }

  if (intent.kidFriendly && sev >= 3) {
    blockingFindings.push('Trail appears too technical (SAC T3+) for a kid-friendly outing.');
  }

  const dogsTag = (tags.dogs || tags.dog)?.toLowerCase();
  if (intent.dogFriendly) {
    if (dogsTag === 'no' || dogsTag === 'leashed_no') {
      blockingFindings.push('OSM indicates dogs are not allowed on this trail, but you asked for dog-friendly.');
    } else if (!dogsTag) {
      assumptions.push('Dog policy not tagged in OSM — confirm local rules before bringing a dog.');
      warnings.push('Dog-friendly requirement could not be verified from map data.');
    }
  }

  const tMin = forecast?.tempMinC;
  const tMax = forecast?.tempMaxC;
  const precip = forecast?.precipProbMax;

  if (intent.weatherTolerance === 'fair_only') {
    if (precip != null && precip >= 55) {
      blockingFindings.push(
        `Forecast rain chance (${Math.round(precip)}%) conflicts with fair-weather-only preference.`
      );
    }
    if (tMin != null && tMin <= 2) {
      warnings.push('Forecast includes near-freezing lows — dress for cold and ice risk.');
      tier = worseTier(tier, 'elevated');
    }
  }

  const winterInterest = inferWinterAlpineInterest(intent, userQuery);
  if (winterInterest && (tMax != null && tMax > 12 || tMin != null && tMin > 5)) {
    warnings.push('You mentioned winter/alpine conditions, but the forecast looks mild — season and elevation may not match.');
  }

  if (tMin != null && tMin < -5) {
    tier = worseTier(tier, 'high');
    warnings.push('Very cold forecast — elevated exposure and gear requirements.');
  }

  if (sev >= 5) {
    tier = worseTier(tier, 'high');
  }
  if (sac && sac.toLowerCase().includes('demanding_alpine')) {
    tier = worseTier(tier, 'extreme');
    warnings.push('Demanding alpine terrain — appropriate only for expert parties with mountaineering skills.');
  }

  if (isUsfs) {
    const hikerManaged = tags.hiker_pedestrian_managed?.toUpperCase() === 'Y' ||
      tags.HIKER_PEDESTRIAN_MANAGED?.toUpperCase() === 'Y' ||
      (tags.managed_use ?? '').toUpperCase().includes('HIKER');
    const packSaddleOnly = !hikerManaged &&
      (tags.pack_saddle_managed?.toUpperCase() === 'Y' ||
       tags.PACK_SADDLE_MANAGED?.toUpperCase() === 'Y');
    if (packSaddleOnly) {
      warnings.push('USFS designates this trail for pack/saddle stock use only — expect shared horse traffic and uneven tread.');
    }
    if (hikerManaged) {
      assumptions.push('USFS confirms hiker/pedestrian is a managed use on this trail.');
    }
  }

  if (tags.wilderness_name) {
    warnings.push(`${tags.wilderness_name} — no mechanized travel, no bikes, group size limits may apply. Check USFS for permit requirements.`);
    if (intent.tripType === 'multi_day') {
      tier = worseTier(tier, 'elevated');
    }
  }

  return { tier, blockingFindings, warnings, assumptions };
}
