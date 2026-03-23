import type { IntentProfile, TrailCandidate, ValidationResult } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import type { HikeForecast } from '../services/weatherService';
import type { PlannerRecommendation, PlannerScoredCandidate, TripRiskTier } from './types';
import { assessFeasibility } from './feasibility';
import { assessSafety } from './safety';
function tierSortKey(t: TripRiskTier): number {
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

function computePlannerConfidence(
  eligible: boolean,
  feasibilityWarnings: number,
  safetyWarnings: number,
  assumptions: number,
  tier: TripRiskTier,
  matchScore: number
): number {
  if (!eligible) {
    return Math.max(5, Math.min(35, Math.round(matchScore * 0.25)));
  }
  let c = 82;
  c -= feasibilityWarnings * 6;
  c -= safetyWarnings * 8;
  c -= assumptions * 4;
  if (tier === 'elevated') c -= 10;
  if (tier === 'high') c -= 22;
  if (tier === 'extreme') c -= 34;
  c = Math.round((c + matchScore) / 2);
  return Math.max(18, Math.min(98, c));
}

function overallFitFromConfidence(conf: number, eligible: boolean): ValidationResult['overallFit'] {
  if (!eligible) return 'poor';
  if (conf >= 78) return 'excellent';
  if (conf >= 62) return 'good';
  if (conf >= 45) return 'fair';
  return 'poor';
}

export function scoreTrailForPlanner(
  intent: IntentProfile,
  trail: TrailData,
  candidate: TrailCandidate,
  forecast: HikeForecast | null,
  userQuery?: string
): PlannerScoredCandidate {
  const feasibility = assessFeasibility(intent, trail);
  const safety = assessSafety(intent, trail, forecast, userQuery);

  const blockingReasons = [...feasibility.blockingReasons, ...safety.blockingFindings];
  const eligible = blockingReasons.length === 0;

  const criticalWarnings = [...feasibility.warnings, ...safety.warnings];
  const assumptions = [...safety.assumptions];

  const plannerConfidence = computePlannerConfidence(
    eligible,
    feasibility.warnings.length,
    safety.warnings.length,
    assumptions.length,
    safety.tier,
    candidate.matchScore
  );

  return {
    trailId: trail.id,
    eligible,
    plannerConfidence,
    tripRiskTier: safety.tier,
    blockingReasons,
    criticalWarnings,
    assumptions,
    feasibility,
    safety,
  };
}

export interface PlannerIntegrationResult {
  candidates: TrailCandidate[];
  validations: ValidationResult[];
  plannerByTrailId: Map<number, PlannerScoredCandidate>;
  recommendation: PlannerRecommendation;
}

/**
 * Re-order candidates with deterministic gates, merge planner verdict into validations (planner wins on fit/confidence/recommendation).
 */
export function integratePlanner(
  intent: IntentProfile,
  forecast: HikeForecast | null,
  trailsById: Map<number, TrailData>,
  candidates: TrailCandidate[],
  llmValidations: ValidationResult[],
  userQuery?: string
): PlannerIntegrationResult {
  const valById = new Map(llmValidations.map((v) => [v.trailId, v]));

  const scored: { candidate: TrailCandidate; trail: TrailData; planner: PlannerScoredCandidate }[] = [];

  for (const c of candidates) {
    const trail = trailsById.get(c.trailId);
    if (!trail) continue;
    const planner = scoreTrailForPlanner(intent, trail, c, forecast, userQuery);
    scored.push({ candidate: c, trail, planner });
  }

  scored.sort((a, b) => {
    if (a.planner.eligible !== b.planner.eligible) return a.planner.eligible ? -1 : 1;
    const tr = tierSortKey(a.planner.tripRiskTier) - tierSortKey(b.planner.tripRiskTier);
    if (tr !== 0) return tr;
    const conf = b.planner.plannerConfidence - a.planner.plannerConfidence;
    if (conf !== 0) return conf;
    return b.candidate.matchScore - a.candidate.matchScore;
  });

  const orderedCandidates = scored.map((s) => s.candidate);
  const plannerByTrailId = new Map(scored.map((s) => [s.planner.trailId, s.planner]));

  const primary = scored.find((s) => s.planner.eligible);
  const primaryTrailId = primary ? primary.planner.trailId : null;

  let status: PlannerRecommendation['status'] = 'none';
  let tripRiskTier: TripRiskTier | null = null;

  if (primary) {
    tripRiskTier = primary.planner.tripRiskTier;
    if (primary.planner.tripRiskTier === 'high' || primary.planner.tripRiskTier === 'extreme') {
      status = 'conditional';
    } else {
      status = 'recommended';
    }
  }

  const criticalWarnings = primary?.planner.criticalWarnings ?? [];
  const assumptions = primary?.planner.assumptions ?? [];
  const geometryDisclaimer = primary?.planner.feasibility.geometryNote ?? scored[0]?.planner.feasibility.geometryNote ?? null;

  const recommendation: PlannerRecommendation = {
    status,
    primaryTrailId,
    blockingReasons: primary ? [] : [...new Set(scored.flatMap((s) => s.planner.blockingReasons))].slice(0, 6),
    criticalWarnings,
    assumptions,
    geometryDisclaimer,
    primaryConfidence: primary ? primary.planner.plannerConfidence : null,
    tripRiskTier,
  };

  const validations: ValidationResult[] = orderedCandidates.map((c) => {
    const base = valById.get(c.trailId);
    const p = plannerByTrailId.get(c.trailId);
    if (!p) {
      return (
        base ?? {
          trailId: c.trailId,
          trailName: c.trailName,
          overallFit: 'poor',
          confidenceScore: 20,
          passedChecks: [],
          warnings: [],
          risks: ['Missing trail data for validation.'],
          isRecommended: false,
        }
      );
    }

    const eligible = p.eligible;
    const isPrimary = eligible && c.trailId === primaryTrailId;

    const mergedWarnings = [...new Set([...p.criticalWarnings, ...p.assumptions.map((a) => `Assumption: ${a}`), ...(base?.warnings ?? [])])];
    const mergedRisks = [...new Set([...p.blockingReasons, ...(base?.risks ?? [])])];
    const passedChecks = [
      ...(base?.passedChecks ?? []),
      ...(eligible ? ['Passed deterministic feasibility & safety gates.'] : []),
    ];

    return {
      trailId: c.trailId,
      trailName: c.trailName,
      overallFit: overallFitFromConfidence(p.plannerConfidence, eligible),
      confidenceScore: p.plannerConfidence,
      passedChecks,
      warnings: mergedWarnings,
      risks: eligible ? (base?.risks ?? []).filter(Boolean) : mergedRisks.length ? mergedRisks : ['Does not meet hard constraints or safety gates.'],
      isRecommended: isPrimary && status !== 'none',
    };
  });

  return {
    candidates: orderedCandidates,
    validations,
    plannerByTrailId,
    recommendation,
  };
}
