import type { IntentProfile } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import type { HikeForecast } from '../services/weatherService';

export type TripRiskTier = 'standard' | 'elevated' | 'high' | 'extreme';

export type PlannerRecommendationStatus = 'recommended' | 'conditional' | 'none';

/** Shared assumption entry emitted by any pipeline stage. */
export interface AssumptionEntry {
  stage: 'intent' | 'effort' | 'feasibility' | 'safety' | 'campsite' | 'weather' | 'scoring';
  text: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface TrailFeasibilityResult {
  eligible: boolean;
  blockingReasons: string[];
  warnings: string[];
  /** Human-readable note about OSM geometry completeness */
  geometryNote: string;
}

export interface TrailSafetyResult {
  tier: TripRiskTier;
  blockingFindings: string[];
  warnings: string[];
  assumptions: string[];
}

/** Per-trail deterministic assessment used for gating and UI */
export interface PlannerScoredCandidate {
  trailId: number;
  eligible: boolean;
  /** Planner-owned confidence 0–100; drops sharply on violations */
  plannerConfidence: number;
  tripRiskTier: TripRiskTier;
  blockingReasons: string[];
  criticalWarnings: string[];
  assumptions: string[];
  feasibility: TrailFeasibilityResult;
  safety: TrailSafetyResult;
}

export interface PlannerRecommendation {
  status: PlannerRecommendationStatus;
  primaryTrailId: number | null;
  /** Shown above results when present */
  blockingReasons: string[];
  criticalWarnings: string[];
  assumptions: string[];
  geometryDisclaimer: string | null;
  /** Confidence for the primary pick only */
  primaryConfidence: number | null;
  tripRiskTier: TripRiskTier | null;
}

export interface PlannerContext {
  intent: IntentProfile;
  forecast: HikeForecast | null;
  /** Original user text for seasonal keywords (optional) */
  userQuery?: string;
}

export type TrailById = Map<number, TrailData>;
