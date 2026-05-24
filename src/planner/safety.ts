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

function inferRequestedMonth(intent: IntentProfile, userQuery?: string): number | null {
  const blob = `${intent.date} ${userQuery || ''}`.toLowerCase();
  const names: Array<[RegExp, number]> = [
    [/\bjan(?:uary)?\b/, 1], [/\bfeb(?:ruary)?\b/, 2], [/\bmar(?:ch)?\b/, 3],
    [/\bapr(?:il)?\b/, 4], [/\bmay\b/, 5], [/\bjun(?:e)?\b/, 6],
    [/\bjul(?:y)?\b/, 7], [/\baug(?:ust)?\b/, 8], [/\bsep(?:t(?:ember)?)?\b/, 9],
    [/\boct(?:ober)?\b/, 10], [/\bnov(?:ember)?\b/, 11], [/\bdec(?:ember)?\b/, 12],
  ];
  for (const [rx, month] of names) if (rx.test(blob)) return month;
  const iso = intent.date.match(/^\d{4}-(\d{2})-/);
  if (iso) {
    const month = Number(iso[1]);
    if (month >= 1 && month <= 12) return month;
  }
  return null;
}

function numericTag(tags: Record<string, string>, keys: string[]): number | null {
  for (const key of keys) {
    const n = Number(tags[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function approximateMaxElevationM(trail: TrailData): number | null {
  return numericTag(trail.tags, [
    'cotrex_max_elevation_m',
    'max_elevation_m',
    'max_elev_m',
    'ele',
  ]);
}

function coloradoSeasonalSnowRisk(month: number | null, trail: TrailData): 'none' | 'moderate' | 'high' {
  if (!month) return 'none';
  const maxElev = approximateMaxElevationM(trail);
  const highCountry = maxElev == null || maxElev >= 2800;
  if (!highCountry) return 'none';
  if ([12, 1, 2, 3, 4].includes(month)) return 'high';
  if ([5, 6, 10, 11].includes(month)) return 'moderate';
  return 'none';
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

  const requestedMonth = inferRequestedMonth(intent, userQuery);
  const seasonalSnowRisk = coloradoSeasonalSnowRisk(requestedMonth, trail);
  if (seasonalSnowRisk === 'high') {
    tier = worseTier(tier, 'high');
    warnings.push('Colorado high-country seasonal conditions: average winter/early-spring conditions commonly include snow and ice. Treat this as harder than summer hiking; microspikes, crampons/ice axe skills, avalanche awareness, and winter navigation may be required depending on route and recent storms.');
  } else if (seasonalSnowRisk === 'moderate') {
    tier = worseTier(tier, 'elevated');
    warnings.push('Colorado high-country shoulder-season conditions may include lingering or early snow/ice, especially on north-facing slopes and passes. Difficulty may be higher than the nominal trail rating; carry traction if current reports indicate snow.');
  } else if (
    requestedMonth === 7 &&
    /colorado|rocky|san juan|front range/i.test(`${intent.location} ${intent.estimatedRegionName}`) &&
    approximateMaxElevationM(trail) != null &&
    (approximateMaxElevationM(trail) ?? 0) >= 3200
  ) {
    warnings.push('July is usually peak season, but Colorado high-elevation routes can still have lingering snowfields, storm damage, or closed access roads. Verify current land-manager conditions before departure.');
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

  if (intent.tripType === 'multi_day' || intent.permitCheckRequired) {
    warnings.push('Permit requirements may apply for overnight travel, wilderness areas, parking, or quota zones. Verify with the official land manager before departure.');
  }

  if (intent.campsiteSupportRequired || intent.tripType === 'multi_day') {
    warnings.push('Campsite availability and legal overnight locations should be confirmed before departure; public datasets may be incomplete or stale.');
  }

  if (intent.seasonalityCheckRequired) {
    warnings.push('This recommendation uses open/public data and coarse seasonality signals; check current trail, weather, fire, and closure reports before committing.');
  }

  if (intent.accessCheckRequired && !tags.access) {
    assumptions.push('Trail access status was not tagged in the primary source.');
  }

  return { tier, blockingFindings, warnings, assumptions };
}
