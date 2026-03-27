/**
 * Terrain-aware effort model using Tobler's hiking function.
 *
 * Tobler's formula: speed = 6 * exp(-3.5 * |slope + 0.05|) km/h
 * where slope = rise / run (vertical / horizontal).
 *
 * This replaces the flat-ground paceKmH lookup that previously
 * treated all trails as level ground regardless of elevation profile.
 */

import type { TrailPoint, TrailData } from '../services/osmService';
import { samplePathPoints, elevationGainLossM } from '../services/elevationService';

const DEG_TO_RAD = Math.PI / 180;
const R_KM = 6371;

function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return R_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface GradeSegment {
  km: number;
  gradePercent: number;
  segmentKm: number;
  elevChangeM: number;
}

export interface EffortEstimate {
  adjustedTimeHours: number;
  timeRangeHours: [number, number];
  flatTimeHours: number;
  totalAscentM: number;
  totalDescentM: number;
  maxGradePercent: number;
  avgGradePercent: number;
  gradeProfile: GradeSegment[];
  assumptions: string[];
}

/**
 * Tobler's hiking function: predicted speed (km/h) for a given slope.
 * slope = rise/run as a fraction (e.g., 0.10 = 10% grade).
 * The optimal slope is about -5% (slight downhill), yielding ~6 km/h.
 */
function toblerSpeedKmH(slope: number): number {
  return 6.0 * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

/** Flat-ground fallback pace by difficulty (used when no elevation data). */
function flatPaceKmH(difficulty: string): number {
  switch (difficulty) {
    case 'easy': return 3.5;
    case 'moderate': return 4.0;
    case 'hard': return 3.5;
    case 'expert': return 3.0;
    default: return 3.8;
  }
}

/**
 * Build a grade profile and effort estimate from trail path + elevation data.
 *
 * If the trail lacks elevation data (elevationGainM undefined), falls back
 * to a flat-ground pace estimate and flags it in assumptions.
 */
export function estimateEffort(
  trail: TrailData,
  options?: { difficultyHint?: string }
): EffortEstimate {
  const assumptions: string[] = [];
  const path = trail.path;
  const difficulty = options?.difficultyHint ?? 'moderate';

  if (path.length < 2) {
    return {
      adjustedTimeHours: 0,
      timeRangeHours: [0, 0],
      flatTimeHours: 0,
      totalAscentM: 0,
      totalDescentM: 0,
      maxGradePercent: 0,
      avgGradePercent: 0,
      gradeProfile: [],
      assumptions: ['Trail has insufficient geometry.'],
    };
  }

  let totalDistKm = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDistKm += haversineKm(path[i], path[i + 1]);
  }
  const flatTime = totalDistKm / flatPaceKmH(difficulty);

  const hasElevation = trail.elevationGainM != null && trail.elevationGainM > 0;

  if (!hasElevation) {
    assumptions.push('[effort] No elevation profile available — using flat-ground pace estimate.');
    const uncertainty = 0.25;
    return {
      adjustedTimeHours: Math.round(flatTime * 10) / 10,
      timeRangeHours: [
        Math.round(flatTime * (1 - uncertainty) * 10) / 10,
        Math.round(flatTime * (1 + uncertainty) * 10) / 10,
      ],
      flatTimeHours: Math.round(flatTime * 10) / 10,
      totalAscentM: 0,
      totalDescentM: 0,
      maxGradePercent: 0,
      avgGradePercent: 0,
      gradeProfile: [],
      assumptions,
    };
  }

  // Sample path for grade computation (reuse the same sampling as elevation service)
  const sampled = samplePathPoints(path, 48);

  // Build cumulative distances and reconstruct elevation from gain/loss ratio
  const segDists: number[] = [];
  for (let i = 0; i < sampled.length - 1; i++) {
    segDists.push(haversineKm(sampled[i], sampled[i + 1]));
  }
  const sampledTotalKm = segDists.reduce((a, b) => a + b, 0);

  // Distribute the known elevation gain/loss proportionally across segments
  // using a simple sinusoidal terrain model scaled to match the known totals
  const totalGain = trail.elevationGainM!;
  const totalLoss = trail.elevationLossM ?? totalGain;
  const netChange = totalGain - totalLoss;
  const nSegs = segDists.length;

  // Build synthetic elevation profile that matches known gain/loss
  const elevations: number[] = [0];
  const segGains: number[] = [];
  for (let i = 0; i < nSegs; i++) {
    const progress = (i + 0.5) / nSegs;
    const trendPerSeg = netChange / nSegs;
    const undulation = (totalGain + totalLoss) / 2 / nSegs;
    const oscillation = Math.sin(progress * Math.PI * 4) * undulation * 0.5;
    const segElev = trendPerSeg + oscillation;
    segGains.push(segElev);
    elevations.push(elevations[i] + segElev);
  }

  // Scale to exactly match known gain/loss
  let synGain = 0, synLoss = 0;
  for (const g of segGains) {
    if (g > 0) synGain += g;
    else synLoss += -g;
  }
  const gainScale = synGain > 0 ? totalGain / synGain : 1;
  const lossScale = synLoss > 0 ? totalLoss / synLoss : 1;
  for (let i = 0; i < segGains.length; i++) {
    segGains[i] = segGains[i] > 0 ? segGains[i] * gainScale : segGains[i] * lossScale;
  }

  // Compute Tobler time and grade profile
  const gradeProfile: GradeSegment[] = [];
  let toblerTimeH = 0;
  let cumKm = 0;
  let maxGrade = 0;
  let sumAbsGrade = 0;

  for (let i = 0; i < nSegs; i++) {
    const dKm = segDists[i];
    if (dKm < 0.001) continue;

    const dElev = segGains[i];
    const slope = dElev / (dKm * 1000); // rise/run
    const gradePercent = Math.round(slope * 1000) / 10;

    const speed = toblerSpeedKmH(slope);
    const segTimeH = dKm / speed;
    toblerTimeH += segTimeH;

    const absGrade = Math.abs(gradePercent);
    if (absGrade > maxGrade) maxGrade = absGrade;
    sumAbsGrade += absGrade;

    gradeProfile.push({
      km: Math.round(cumKm * 10) / 10,
      gradePercent,
      segmentKm: Math.round(dKm * 100) / 100,
      elevChangeM: Math.round(dElev),
    });
    cumKm += dKm;
  }

  const avgGrade = nSegs > 0 ? Math.round((sumAbsGrade / nSegs) * 10) / 10 : 0;

  // Fatigue multiplier: 10% for trips 15-25 km, 15% for 25+ km
  let fatigueFactor = 1.0;
  if (totalDistKm > 25) {
    fatigueFactor = 1.15;
    assumptions.push('[effort] Applied 15% fatigue factor for distance > 25 km.');
  } else if (totalDistKm > 15) {
    fatigueFactor = 1.10;
    assumptions.push('[effort] Applied 10% fatigue factor for distance > 15 km.');
  }

  // Difficulty adjustment: easier hikers are slower, experts can be faster
  let difficultyFactor = 1.0;
  switch (difficulty) {
    case 'easy': difficultyFactor = 1.25; break;
    case 'moderate': difficultyFactor = 1.0; break;
    case 'hard': difficultyFactor = 0.9; break;
    case 'expert': difficultyFactor = 0.85; break;
  }

  const adjustedTime = toblerTimeH * fatigueFactor * difficultyFactor;
  const uncertainty = 0.15;

  assumptions.push(`[effort] Tobler's hiking function applied to ${nSegs} segments, ${totalGain} m gain, ${totalLoss} m loss.`);

  return {
    adjustedTimeHours: Math.round(adjustedTime * 10) / 10,
    timeRangeHours: [
      Math.round(adjustedTime * (1 - uncertainty) * 10) / 10,
      Math.round(adjustedTime * (1 + uncertainty) * 10) / 10,
    ],
    flatTimeHours: Math.round(flatTime * 10) / 10,
    totalAscentM: totalGain,
    totalDescentM: totalLoss,
    maxGradePercent: Math.round(maxGrade * 10) / 10,
    avgGradePercent: avgGrade,
    gradeProfile,
    assumptions,
  };
}

/**
 * Quick effort time for a single trail (hours).
 * Used by feasibility gates as a replacement for the old flat paceKmH.
 */
export function effortTimeHours(trail: TrailData, difficulty?: string): number {
  return estimateEffort(trail, { difficultyHint: difficulty }).adjustedTimeHours;
}

// ── Effort difficulty tier ──────────────────────────────────────────

export type EffortTier = 'Easy' | 'Moderate' | 'Challenging' | 'Difficult' | 'Very Difficult';

/**
 * Classify a trail into one of five effort tiers based on the computed
 * effort estimate. Uses avg grade, total ascent, and pace (min/km) as
 * the three axes. All thresholds are AND — a trail must exceed ANY
 * single "Very Difficult" threshold to be classified there, but must
 * stay under ALL thresholds of a tier to qualify for it.
 */
export function effortDifficultyTier(est: EffortEstimate, distanceKm: number): EffortTier {
  if (est.totalAscentM === 0 && est.gradeProfile.length === 0) {
    return 'Moderate';
  }

  const minPerKm = distanceKm > 0 ? (est.adjustedTimeHours * 60) / distanceKm : 0;
  const avg = est.avgGradePercent;
  const ascent = est.totalAscentM;

  if (avg >= 20 || ascent >= 1800 || minPerKm >= 45) return 'Very Difficult';
  if (avg >= 15 || ascent >= 1200 || minPerKm >= 35) return 'Difficult';
  if (avg >= 10 || ascent >= 700 || minPerKm >= 25) return 'Challenging';
  if (avg >= 5 || ascent >= 300 || minPerKm >= 20) return 'Moderate';
  return 'Easy';
}

/** UI color token for each effort tier. */
export function effortTierColor(tier: EffortTier): string {
  switch (tier) {
    case 'Easy': return 'text-green';
    case 'Moderate': return 'text-teal';
    case 'Challenging': return 'text-amber';
    case 'Difficult': return 'text-orange';
    case 'Very Difficult': return 'text-red';
  }
}
