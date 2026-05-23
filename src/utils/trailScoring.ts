import { TrailData } from '../services/osmService';
import { RecommendationPreferences, type IntentProfile } from '../services/geminiService';
import { estimateEffort, type EffortEstimate } from '../planner/effort';

/**
 * Best-effort scoring utility to rank OSM trails based on user preferences.
 * Since OSM data can be sparse, this relies heavily on tag presence and basic heuristics.
 */
export function scoreAndFilterTrails(trails: TrailData[], prefs: RecommendationPreferences): TrailData[] {
  const difficultyMap = {
    beginner: ['hiking', 't1'],
    intermediate: ['mountain_hiking', 't2', 't3'],
    advanced: ['demanding_mountain_hiking', 'alpine_hiking', 't4', 't5'],
    extreme: ['demanding_alpine_hiking', 'difficult_alpine_hiking', 't6'],
  };

  const targetDifficultyTags = prefs.difficulty ? difficultyMap[prefs.difficulty] : [];
  const targetKm = prefs.maxDistance || 5;
  const isMultiDay = prefs.tripType === 'multi_day';

  const scored = trails
    .map((trail) => {
      let score = 0;
      const tags = trail.tags;

      if (prefs.difficulty && tags.sac_scale) {
        if (targetDifficultyTags.some((dt) => tags.sac_scale.includes(dt))) {
          score += 30;
        } else {
          score -= 10;
        }
      } else if (prefs.difficulty === 'beginner' && (!tags.sac_scale || tags.sac_scale === 'hiking')) {
        score += 15;
      } else if (prefs.difficulty !== 'beginner' && !tags.sac_scale) {
        score -= isMultiDay ? 2 : 5;
      }

      if (prefs.terrain && prefs.terrain.length > 0 && tags.surface) {
        prefs.terrain.forEach((t) => {
          if (tags.surface?.toLowerCase().includes(t.toLowerCase())) score += 10;
        });
      }

      if (prefs.features && prefs.features.length > 0 && trail.name) {
        prefs.features.forEach((f) => {
          if (trail.name?.toLowerCase().includes(f.toLowerCase())) score += 20;
        });
      }

      if (trail.name) score += 5;

      const dist = effectiveTrailDistanceKm(trail);
      const ratio = targetKm > 0 ? dist / targetKm : 0;

      if (isMultiDay) {
        // For multi-day, distance match is the dominant signal
        if (ratio >= 0.6 && ratio <= 1.4) {
          score += 60;
        } else if (ratio >= 0.4 && ratio <= 2.0) {
          score += 35;
        } else if (ratio >= 0.3) {
          score += 10;
        }

        if (ratio < 0.3) {
          score -= 40;
        }

        if ((tags.trailscout_source ?? '').includes('usfs_nfs') || tags.trailscout_source === 'cotrex' || tags.trailscout_source === 'assembled_route') {
          score += tags.trailscout_source === 'assembled_route' ? 18 : 8;
        }
      } else {
        if (ratio < 0.05) {
          score -= 50;
        } else if (ratio < 0.15) {
          score -= 28;
        } else if (ratio < 0.25) {
          score -= 14;
        }

        if (ratio >= 0.7 && ratio <= 1.2) {
          score += 38;
        } else if (ratio >= 0.5) {
          score += 28;
        } else if (ratio >= 0.25) {
          score += 14;
        } else if (ratio >= 0.2) {
          score += 6;
        }

        if (ratio > 1.5) {
          score -= 12;
        }
      }

      return { trail, score, dist };
    })
    .filter((item) => item.trail.path.length >= 2)
    .sort((a, b) => b.score - a.score);

  const minFloorStrong = isMultiDay
    ? Math.max(24, 0.45 * targetKm)
    : Math.max(1.0, 0.25 * targetKm);
  let filtered = scored.filter((s) => s.dist >= minFloorStrong);

  if (!isMultiDay && filtered.length === 0) {
    console.warn('[trailScoring] No trails above length floor; relaxing min distance filter');
    const minFloorRelaxed = Math.max(0.4, 0.08 * targetKm);
    filtered = scored.filter((s) => s.dist >= minFloorRelaxed);
  }

  if (isMultiDay && filtered.length === 0 && prefs.allowMultiDayContextFallback) {
    // Keep the route-quality gate strict: these candidates are NOT treated as valid treks.
    // Returning the strongest context candidates lets the downstream deterministic planner
    // explain why every trail failed instead of aborting with an opaque "survived filtering" toast.
    const contextFloorKm = Math.max(8, Math.min(24, targetKm * 0.20));
    filtered = scored.filter((s) => s.dist >= contextFloorKm).slice(0, 10);
    console.warn(
      `[trailScoring] No multi-day candidates met ${minFloorStrong.toFixed(1)} km floor; ` +
      `returning ${filtered.length} context candidate(s) above ${contextFloorKm.toFixed(1)} km for gate reporting`
    );
  }

  if (!isMultiDay && filtered.length === 0) {
    console.warn('[trailScoring] Still empty; returning best-effort score order');
    filtered = scored;
  }

  console.info(`[trailScoring] targetKm=${targetKm.toFixed(1)}, multiDay=${isMultiDay}, minFloor=${minFloorStrong.toFixed(1)}, passed=${filtered.length}/${scored.length}, top="${filtered[0]?.trail.name}" (${filtered[0]?.dist.toFixed(1)} km, score=${filtered[0]?.score})`);

  return filtered.map((s) => s.trail);
}

/**
 * Calculates the total distance of a trail path in kilometers.
 * Uses the Haversine formula.
 */
export function calculateDistance(path: { lat: number; lng: number }[]): number {
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const degToRad = Math.PI / 180;
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * degToRad;
    const dLon = (p2.lng - p1.lng) * degToRad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * degToRad) * Math.cos(p2.lat * degToRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalDist += R * c;
  }
  return totalDist;
}

export function effectiveTrailDistanceKm(trail: TrailData): number {
  const tagged = Number(trail.tags?.trailscout_length_km);
  const geometry = calculateDistance(trail.path);
  if (Number.isFinite(tagged) && tagged > 0) {
    // COTREX/official services can expose authoritative route length even when map geometry is
    // simplified for browser performance. Prefer the larger value so multi-day scoring does not
    // demote valid Colorado route sections as tiny sampled segments.
    return Math.max(tagged, geometry);
  }
  return geometry;
}

/**
 * Deterministic composite match score (0–100).
 *
 * Weights: distance ratio (40%), elevation/effort fit (25%),
 * tag/feature match (20%), source quality (15%).
 *
 * This replaces the LLM-assigned matchScore so the Research Agent
 * is only responsible for prose explanation.
 */
export function computeDeterministicMatchScore(
  trail: TrailData,
  intent: IntentProfile,
): number {
  const distKm = effectiveTrailDistanceKm(trail);
  const isMultiDay = intent.tripType === 'multi_day';
  const targetKm = isMultiDay
    ? Math.max(intent.searchDistanceKm, intent.dailyDistanceKm * intent.tripLengthDays)
    : Math.max(intent.maxDistanceKm, 1);

  // ── Distance ratio component (0–40) ──
  const ratio = targetKm > 0 ? distKm / targetKm : 0;
  let distScore: number;
  if (ratio >= 0.8 && ratio <= 1.2) distScore = 40;
  else if (ratio >= 0.6 && ratio <= 1.4) distScore = 32;
  else if (ratio >= 0.4 && ratio <= 1.8) distScore = 20;
  else if (ratio >= 0.25) distScore = 10;
  else distScore = 2;

  // ── Elevation / effort fit (0–25) ──
  let effortScore = 12; // neutral default
  const effort = estimateEffort(trail, { difficultyHint: intent.difficulty });
  if (effort.totalAscentM > 0) {
    const daylightH = isMultiDay ? 8 * intent.tripLengthDays : 10;
    const effortRatio = effort.adjustedTimeHours / daylightH;
    if (effortRatio >= 0.4 && effortRatio <= 0.85) effortScore = 25;
    else if (effortRatio >= 0.25 && effortRatio <= 1.0) effortScore = 18;
    else if (effortRatio > 1.0) effortScore = 5;
    else effortScore = 10;
  }

  // ── Tag / feature match (0–20) ──
  let tagScore = 5;
  const tags = trail.tags;
  const diffMap: Record<string, string[]> = {
    easy: ['hiking', 't1'],
    moderate: ['mountain_hiking', 't2', 't3'],
    hard: ['demanding_mountain_hiking', 'alpine_hiking', 't4', 't5'],
    expert: ['demanding_alpine_hiking', 'difficult_alpine_hiking', 't6'],
  };
  const targetTags = diffMap[intent.difficulty] ?? [];
  if (tags.sac_scale && targetTags.some(t => tags.sac_scale.includes(t))) {
    tagScore += 8;
  }
  if (trail.name) tagScore += 3;
  const scenery = intent.sceneryPreferences ?? [];
  if (scenery.length > 0 && trail.name) {
    const nameLower = trail.name.toLowerCase();
    const hits = scenery.filter(f => nameLower.includes(f.toLowerCase()));
    tagScore += Math.min(4, hits.length * 2);
  }
  tagScore = Math.min(20, tagScore);

  // ── Source quality (0–15) ──
  let sourceScore = 5;
  const src = tags.trailscout_source ?? '';
  if (src === 'assembled_route') sourceScore = 14;
  else if (src.includes('usfs_nfs') || src === 'cotrex') sourceScore = 15;
  else if (src === 'osm_relation') sourceScore = 12;
  else if (src === 'osm_way_segment') sourceScore = 7;

  const total = Math.round(Math.min(100, Math.max(5, distScore + effortScore + tagScore + sourceScore)));
  return total;
}
