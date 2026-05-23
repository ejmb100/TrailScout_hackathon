import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Multi-Agent Gemini Service for TrailScout
 * 
 * Agent 1: Intent Agent — Parses NL into structured preferences
 * Agent 2: Research Agent — Enriches trail data with context 
 * Agent 3: Validation Agent — Validates trails against constraints
 * Agent 4: Action Agent — Generates trip plan and actions
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export type TripType = 'day_hike' | 'multi_day';

export interface IntentProfile {
  location: string;
  date: string;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  tripType: TripType;
  tripLengthDays: number;
  maxDistanceKm: number;
  dailyDistanceKm: number;
  searchDistanceKm: number;
  elevationPreference: 'flat' | 'rolling' | 'steep' | 'any';
  sceneryPreferences: string[];
  crowdPreference: 'low' | 'moderate' | 'any';
  dogFriendly: boolean;
  kidFriendly: boolean;
  weatherTolerance: 'fair_only' | 'light_rain_ok' | 'any';
  latestReturnTime: string;
  driveTimeTolerance: string;
  reasoning: string;
  estimatedRegionName: string;
  bbox: BoundingBox;
  followUpQuestions: string[];
}

export interface TrailCandidate {
  trailId: number;
  trailName: string;
  matchScore: number;
  matchExplanation: string;
  estimatedDriveTime: string;
  weatherForecast: string;
  crowdLevel: 'low' | 'moderate' | 'high';
  bestTimeToGo: string;
  sceneryHighlights: string[];
  trailImageQuery: string;
  /** Injected client-side from OSM path length for validation (km). */
  distanceKm?: number;
}

export interface ValidationResult {
  trailId: number;
  trailName: string;
  overallFit: 'excellent' | 'good' | 'fair' | 'poor';
  confidenceScore: number;
  passedChecks: string[];
  warnings: string[];
  risks: string[];
  isRecommended: boolean;
}

export interface TripPlan {
  recommendedTrailId: number;
  recommendedTrailName: string;
  tripType: TripType;
  tripLengthDays: number;
  whyChosen: string;
  departureTime: string;
  expectedReturnTime: string;
  estimatedDuration: string;
  driveTime: string;
  dailyPlan: string[] | string;
  whatToBring: string[] | string;
  safetyNotes: string[] | string;
  logisticsNotes: string[] | string;
  routeNotes: string;
  weatherSummary: string;
  conditionsSummary: string;
  backupTrailId: number;
  backupTrailName: string;
  backupReason: string;
  packingChecklist: string[] | string;
  calendarTitle: string;
  calendarDescription: string;
  shareableSummary: string;
}

// ─── Gemini Setup ──────────────────────────────────────────────────────

const geminiApiKey = (__TRAILSCOUT_GEMINI__ || '').trim();
export const isGeminiApiKeyConfigured = geminiApiKey.length > 0;

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

function cleanJsonResponse(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inferTripLengthDays(raw: Record<string, unknown>, locationHint?: string): number {
  const explicit =
    parseFiniteNumber(raw.tripLengthDays) ??
    parseFiniteNumber(raw.durationDays) ??
    parseFiniteNumber(raw.days);
  if (explicit != null) {
    return clamp(Math.round(explicit), 1, 14);
  }

  const text = String(locationHint || '').toLowerCase();
  const ranged = text.match(/(\d+)\s*-\s*(\d+)\s*day/);
  if (ranged) {
    return clamp(Math.round((Number(ranged[1]) + Number(ranged[2])) / 2), 1, 14);
  }

  const exact = text.match(/(\d+)\s*day/);
  if (exact) {
    return clamp(Number(exact[1]), 1, 14);
  }

  if (/\bovernight\b/.test(text)) return 2;
  if (/\bbackpack(?:ing)?\b/.test(text)) return 2;
  return 1;
}

function inferTripType(raw: Record<string, unknown>, tripLengthDays: number, locationHint?: string): TripType {
  if (tripLengthDays > 1) return 'multi_day';

  const text = String(locationHint || '').toLowerCase();
  if (/\bovernight\b|\bbackpack(?:ing)?\b|\bmulti[- ]?day\b/.test(text)) {
    return 'multi_day';
  }

  if (raw.tripType === 'multi_day') return 'multi_day';
  return 'day_hike';
}

function deriveSearchDistanceKm(
  tripType: TripType,
  tripLengthDays: number,
  totalDistanceKm: number,
  rawSearchDistanceKm?: unknown,
  rawDailyDistanceKm?: unknown
): { dailyDistanceKm: number; searchDistanceKm: number } {
  if (tripType === 'day_hike') {
    return {
      dailyDistanceKm: totalDistanceKm,
      searchDistanceKm: totalDistanceKm,
    };
  }

  const MULTI_DAY_DAILY_FLOOR_KM = 12;
  const rawDaily = parseFiniteNumber(rawDailyDistanceKm) ??
    (tripLengthDays > 0 ? totalDistanceKm / tripLengthDays : totalDistanceKm);
  const dailyDistanceKm = clamp(Math.max(rawDaily, MULTI_DAY_DAILY_FLOOR_KM), MULTI_DAY_DAILY_FLOOR_KM, 40);
  const totalTarget = dailyDistanceKm * tripLengthDays;

  const requestedSearchDistance = parseFiniteNumber(rawSearchDistanceKm);
  const searchDistanceKm = clamp(
    requestedSearchDistance ?? totalTarget,
    MULTI_DAY_DAILY_FLOOR_KM,
    Math.max(totalTarget, totalDistanceKm)
  );

  return {
    dailyDistanceKm,
    searchDistanceKm,
  };
}

function fallbackRegionForLocation(locationHint: string | undefined): {
  location: string;
  estimatedRegionName: string;
  bbox: BoundingBox;
} {
  const text = String(locationHint || '').toLowerCase();

  if (/colorado|rocky mountain|rmnp|estes park|boulder|denver/.test(text)) {
    return {
      location: String(locationHint || 'Colorado'),
      estimatedRegionName: 'Colorado Front Range',
      bbox: { minLat: 39.2, maxLat: 40.4, minLon: -106.3, maxLon: -104.6 },
    };
  }

  if (/seattle|cascades|washington/.test(text)) {
    return {
      location: String(locationHint || 'Seattle'),
      estimatedRegionName: 'Central Cascades',
      bbox: { minLat: 47.25, maxLat: 47.95, minLon: -122.25, maxLon: -121.1 },
    };
  }

  if (/portland|oregon/.test(text)) {
    return {
      location: String(locationHint || 'Portland'),
      estimatedRegionName: 'Columbia Gorge',
      bbox: { minLat: 45.35, maxLat: 45.9, minLon: -122.3, maxLon: -121.3 },
    };
  }

  if (/asheville|north carolina|blue ridge/.test(text)) {
    return {
      location: String(locationHint || 'Asheville'),
      estimatedRegionName: 'Blue Ridge Mountains',
      bbox: { minLat: 35.3, maxLat: 35.95, minLon: -83.2, maxLon: -81.9 },
    };
  }

  if (/san juan|weminuche|durango|silverton|pagosa|ouray|telluride/.test(text)) {
    return {
      location: String(locationHint || 'San Juan National Forest'),
      estimatedRegionName: 'San Juan National Forest',
      bbox: { minLat: 37.45, maxLat: 38.2, minLon: -108.2, maxLon: -107.0 },
    };
  }

  if (/swiss|alps|switzerland/.test(text)) {
    return {
      location: String(locationHint || 'Swiss Alps'),
      estimatedRegionName: 'Swiss Alps',
      bbox: { minLat: 46.2, maxLat: 46.95, minLon: 7.3, maxLon: 8.7 },
    };
  }

  return {
    location: String(locationHint || 'Pacific Northwest'),
    estimatedRegionName: 'Pacific Northwest',
    bbox: { minLat: 47.5, maxLat: 47.7, minLon: -121.8, maxLon: -121.5 },
  };
}

function targetBBoxSpanDeg(maxDistanceKm: number): number {
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0) return 0.18;
  if (maxDistanceKm >= 18) return 0.28;
  if (maxDistanceKm >= 10) return 0.22;
  if (maxDistanceKm >= 5) return 0.14;
  return 0.1;
}

function normalizeBBox(
  rawBBox: unknown,
  fallbackBBox: BoundingBox,
  maxDistanceKm: number
): BoundingBox {
  const fallback = { ...fallbackBBox };
  if (!rawBBox || typeof rawBBox !== 'object') return fallback;

  const raw = rawBBox as Record<string, unknown>;
  let minLat = parseFiniteNumber(raw.minLat);
  let maxLat = parseFiniteNumber(raw.maxLat);
  let minLon = parseFiniteNumber(raw.minLon);
  let maxLon = parseFiniteNumber(raw.maxLon);

  if ([minLat, maxLat, minLon, maxLon].some((v) => v == null)) {
    return fallback;
  }

  minLat = clamp(minLat!, -85, 85);
  maxLat = clamp(maxLat!, -85, 85);
  minLon = clamp(minLon!, -180, 180);
  maxLon = clamp(maxLon!, -180, 180);

  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];

  const minSpan = targetBBoxSpanDeg(maxDistanceKm);
  const maxSpan = 4.5;

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const latSpan = clamp(Math.max(maxLat - minLat, minSpan), minSpan, maxSpan);
  const lonSpan = clamp(Math.max(maxLon - minLon, minSpan), minSpan, maxSpan);

  return {
    minLat: clamp(centerLat - latSpan / 2, -85, 85),
    maxLat: clamp(centerLat + latSpan / 2, -85, 85),
    minLon: clamp(centerLon - lonSpan / 2, -180, 180),
    maxLon: clamp(centerLon + lonSpan / 2, -180, 180),
  };
}

function buildDefaultIntentProfile(reasoning: string, locationHint?: string): IntentProfile {
  const region = fallbackRegionForLocation(locationHint);
  return {
    location: region.location,
    date: 'today',
    difficulty: 'moderate',
    tripType: 'day_hike',
    tripLengthDays: 1,
    maxDistanceKm: 10,
    dailyDistanceKm: 10,
    searchDistanceKm: 10,
    elevationPreference: 'any',
    sceneryPreferences: ['forest', 'mountain'],
    crowdPreference: 'any',
    dogFriendly: false,
    kidFriendly: false,
    weatherTolerance: 'any',
    latestReturnTime: 'none',
    driveTimeTolerance: 'any',
    reasoning,
    estimatedRegionName: region.estimatedRegionName,
    bbox: region.bbox,
    followUpQuestions: [],
  };
}

function normalizeIntentProfile(raw: unknown, locationHint?: string): IntentProfile {
  const fallback = buildDefaultIntentProfile(
    'Some request details were missing or malformed, so TrailScout filled in safe defaults.',
    locationHint
  );

  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const data = raw as Record<string, unknown>;
  const region = fallbackRegionForLocation(
    typeof data.location === 'string' && data.location.trim() ? data.location : locationHint
  );

  const maxDistanceKm = clamp(parseFiniteNumber(data.maxDistanceKm) ?? fallback.maxDistanceKm, 1, 80);
  const tripLengthDays = inferTripLengthDays(data, locationHint);
  const tripType = inferTripType(data, tripLengthDays, locationHint);
  const distanceTargets = deriveSearchDistanceKm(
    tripType,
    tripLengthDays,
    maxDistanceKm,
    data.searchDistanceKm,
    data.dailyDistanceKm
  );
  const bbox = normalizeBBox(data.bbox, region.bbox, distanceTargets.searchDistanceKm);

  const difficulty =
    data.difficulty === 'easy' ||
    data.difficulty === 'moderate' ||
    data.difficulty === 'hard' ||
    data.difficulty === 'expert'
      ? data.difficulty
      : fallback.difficulty;

  const elevationPreference =
    data.elevationPreference === 'flat' ||
    data.elevationPreference === 'rolling' ||
    data.elevationPreference === 'steep' ||
    data.elevationPreference === 'any'
      ? data.elevationPreference
      : fallback.elevationPreference;

  const crowdPreference =
    data.crowdPreference === 'low' ||
    data.crowdPreference === 'moderate' ||
    data.crowdPreference === 'any'
      ? data.crowdPreference
      : fallback.crowdPreference;

  const weatherTolerance =
    data.weatherTolerance === 'fair_only' ||
    data.weatherTolerance === 'light_rain_ok' ||
    data.weatherTolerance === 'any'
      ? data.weatherTolerance
      : fallback.weatherTolerance;

  const sceneryPreferences = Array.isArray(data.sceneryPreferences)
    ? data.sceneryPreferences.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
    : fallback.sceneryPreferences;

  const followUpQuestions = Array.isArray(data.followUpQuestions)
    ? data.followUpQuestions.map((item) => String(item).trim()).filter(Boolean).slice(0, 2)
    : [];

  return {
    location: typeof data.location === 'string' && data.location.trim() ? data.location.trim() : region.location,
    date: typeof data.date === 'string' && data.date.trim() ? data.date.trim() : fallback.date,
    difficulty,
    tripType,
    tripLengthDays,
    maxDistanceKm,
    dailyDistanceKm: distanceTargets.dailyDistanceKm,
    searchDistanceKm: distanceTargets.searchDistanceKm,
    elevationPreference,
    sceneryPreferences: sceneryPreferences.length > 0 ? sceneryPreferences : fallback.sceneryPreferences,
    crowdPreference,
    dogFriendly: Boolean(data.dogFriendly),
    kidFriendly: Boolean(data.kidFriendly),
    weatherTolerance,
    latestReturnTime:
      typeof data.latestReturnTime === 'string' && data.latestReturnTime.trim()
        ? data.latestReturnTime.trim()
        : fallback.latestReturnTime,
    driveTimeTolerance:
      typeof data.driveTimeTolerance === 'string' && data.driveTimeTolerance.trim()
        ? data.driveTimeTolerance.trim()
        : fallback.driveTimeTolerance,
    reasoning:
      typeof data.reasoning === 'string' && data.reasoning.trim()
        ? data.reasoning.trim()
        : fallback.reasoning,
    estimatedRegionName:
      typeof data.estimatedRegionName === 'string' && data.estimatedRegionName.trim()
        ? data.estimatedRegionName.trim()
        : region.estimatedRegionName,
    bbox,
    followUpQuestions,
  };
}

// ─── Agent 1: Intent Agent ────────────────────────────────────────────

export async function runIntentAgent(userRequest: string): Promise<IntentProfile> {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `You are the INTENT AGENT in a multi-agent outdoor planning system called TrailScout.

Your job: Parse the user's natural-language hiking request into a structured search profile.

Today's date: ${today}

USER REQUEST: "${userRequest}"

Extract and return a JSON object with these fields:
{
  "location": "specific place/region (if not specified, pick a beautiful hiking destination)",
  "date": "YYYY-MM-DD or 'today' or 'tomorrow'",
  "difficulty": "easy" | "moderate" | "hard" | "expert",
  "tripType": "day_hike" | "multi_day",
  "tripLengthDays": number,
  "maxDistanceKm": number (convert miles to km if needed. 1 mile = 1.60934 km). This is the user's desired TOTAL hike length for the outing (out-and-back, loop, or one-way as they described),
  "dailyDistanceKm": number (for multi-day trips, estimate a realistic average daily mileage in km; for day hikes it can match maxDistanceKm),
  "searchDistanceKm": number (for multi-day trips, set this to a substantial route-discovery target rather than the full trip total),
  "elevationPreference": "flat" | "rolling" | "steep" | "any",
  "sceneryPreferences": ["lake", "forest", "mountain", "waterfall", "ridge", "meadow", "river", etc.],
  "crowdPreference": "low" | "moderate" | "any",
  "dogFriendly": boolean,
  "kidFriendly": boolean,
  "weatherTolerance": "fair_only" | "light_rain_ok" | "any",
  "latestReturnTime": "HH:MM" or "none",
  "driveTimeTolerance": "< 30 min" | "< 1 hour" | "< 2 hours" | "any",
  "reasoning": "2-3 sentences explaining how you interpreted the request",
  "estimatedRegionName": "Human-readable region name",
  "bbox": { "minLat": number, "maxLat": number, "minLon": number, "maxLon": number },
  "followUpQuestions": ["any clarifying questions you would ask, max 2"]
}

For the bbox: Make it proportional to the route-discovery target, not the full backpacking trip total. For 10+ km route discovery use about 0.15-0.3 degree spread. For shorter walks, 0.05-0.1. Avoid giant statewide boxes for multi-day trips.
If no location specified, choose a spectacular hiking destination and explain why.

maxDistanceKm must reflect the full hike or backpacking trip the user asked for (e.g. "10 mile hike" -> ~16 km, "3 day backpacking trip around 30 miles" -> ~48 km). Do not understate this number.

Respond ONLY with valid JSON.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return normalizeIntentProfile(JSON.parse(cleanJsonResponse(text)), userRequest);
  } catch (error) {
    console.error('[Intent Agent] Failed:', error);
    return buildDefaultIntentProfile(
      'Error parsing your request. Using default moderate hike preferences.',
      userRequest
    );
  }
}

// ─── Agent 2: Research Agent ──────────────────────────────────────────

export function fallbackResearchCandidates(trailsRaw: any[]): TrailCandidate[] {
  return trailsRaw.slice(0, 5).map((t, i) => ({
    trailId: t.id,
    trailName: t.name,
    matchScore: 80 - i * 10,
    matchExplanation: 'Auto-ranked by distance and difficulty match.',
    estimatedDriveTime: '~30 min',
    weatherForecast: 'Check local conditions',
    crowdLevel: 'moderate' as const,
    bestTimeToGo: '8:00 AM',
    sceneryHighlights: ['Forest', 'Trail'],
    trailImageQuery: `${t.name} hiking trail`,
  }));
}

export function fallbackValidationResults(
  candidates: TrailCandidate[],
  intent?: Pick<IntentProfile, 'tripType' | 'maxDistanceKm' | 'searchDistanceKm'>
): ValidationResult[] {
  const targetKm =
    intent?.tripType === 'multi_day'
      ? intent.searchDistanceKm
      : intent?.maxDistanceKm ?? 1;

  return candidates.map((c, i) => {
    const dist = c.distanceKm ?? 0;
    const ratio = intentRatio(dist, targetKm);
    return {
      trailId: c.trailId,
      trailName: c.trailName,
      overallFit: i === 0 ? 'excellent' : i < 3 ? 'good' : ratio >= 0.35 ? 'fair' : 'poor',
      confidenceScore: Math.max(55, 85 - i * 10),
      passedChecks: [
        dist > 0 ? `Mapped trail length available (${dist.toFixed(1)} km).` : 'Basic trail data available.',
        'Fallback validation used because model output was incomplete.',
      ],
      warnings:
        dist <= 0
          ? ['Trail length estimate is limited.']
          : ratio < 0.55
            ? [
                intent?.tripType === 'multi_day'
                  ? 'Mapped route length is shorter than the desired multi-day discovery target.'
                  : 'Mapped route length is shorter than the requested hike distance.',
              ]
            : [],
      risks: ['Review current conditions before you go.'],
      isRecommended: false,
    };
  });
}

function intentRatio(distanceKm: number, targetKm: number): number {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(targetKm) || targetKm <= 0) return 0;
  return distanceKm / targetKm;
}

export async function runResearchAgent(
  intent: IntentProfile,
  trailsRaw: any[]
): Promise<TrailCandidate[]> {
  const trailSummary = trailsRaw.slice(0, 20).map(t => ({
    id: t.id,
    name: t.name,
    distanceKm: t.distanceKm,
    elevationGainM: t.elevationGainM,
    elevationLossM: t.elevationLossM,
    tags: t.tags
  }));

  const prompt = `You are the RESEARCH AGENT in a multi-agent outdoor planning system.

The Intent Agent extracted this profile:
${JSON.stringify(intent, null, 2)}

Here are candidate trails from OpenStreetMap:
${JSON.stringify(trailSummary, null, 2)}

CRITICAL LENGTH RULE: intent.maxDistanceKm is the user's desired TOTAL outing distance. intent.searchDistanceKm is the route-discovery target that should guide matching, especially for multi-day backpacking trips. Each trail's distanceKm is the length of the mapped OSM geometry (full route relation when available, otherwise a named way segment). For day hikes, compare primarily to intent.maxDistanceKm. For multi-day trips, compare primarily to intent.searchDistanceKm, while noting that the full trip may extend beyond the mapped geometry. Mention length mismatch honestly in matchExplanation when the trail is much shorter than the requested outing or too small to support a multi-day plan.

When present, use elevationGainM and elevationLossM (meters, sampled along the trail: USGS 3DEP in the United States, otherwise coarse global DEM) in match explanations and difficulty context.

For each trail (up to the top 5 best matches), produce a research analysis:
{
  "trailId": number,
  "trailName": "string",
  "matchScore": number (0-100, how well it matches the intent — NOTE: this will be overridden by a deterministic score downstream, so focus your effort on matchExplanation quality instead),
  "matchExplanation": "2-3 sentences explaining why this trail fits or does not fit the request. Be specific about distance match, terrain character, scenery, and any concerns. This explanation is the primary value you provide — the scoring is handled deterministically.",
  "estimatedDriveTime": "estimate from the region center",
  "weatherForecast": "realistic weather estimate for ${intent.date} in ${intent.location}",
  "crowdLevel": "low" | "moderate" | "high" (estimate based on trail type and popularity),
  "bestTimeToGo": "recommended start time",
  "sceneryHighlights": ["key scenic features"],
  "trailImageQuery": "a search query that would find a good photo of this specific area"
}

Return a JSON ARRAY of these objects, sorted by matchScore descending. Max 5 trails.
Respond ONLY with valid JSON array.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(cleanJsonResponse(text));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallbackResearchCandidates(trailsRaw);
    }
    return parsed;
  } catch (error) {
    console.error('[Research Agent] Failed:', error);
    return fallbackResearchCandidates(trailsRaw);
  }
}

// ─── Agent 3: Validation Agent ────────────────────────────────────────

export async function runValidationAgent(
  intent: IntentProfile,
  candidates: TrailCandidate[]
): Promise<ValidationResult[]> {
  const prompt = `You are the VALIDATION AGENT in a multi-agent outdoor planning system.

Your job: Rigorously validate each trail candidate against the user's constraints.

User's Intent Profile:
${JSON.stringify(intent, null, 2)}

Candidate trails from Research Agent:
${JSON.stringify(candidates, null, 2)}

Each candidate may include distanceKm (mapped OpenStreetMap path length in km). For day hikes compare distanceKm to intent.maxDistanceKm. For multi-day trips compare first to intent.searchDistanceKm, while also considering whether the trail system seems capable of supporting the total trip distance intent.maxDistanceKm. If distanceKm is far below the relevant target, lower overallFit, add warnings, and note the mismatch. If distanceKm is missing, infer cautiously from trailName and matchExplanation.

For each trail, perform these checks:
- Distance appropriate relative to maxDistanceKm (mapped OSM length vs user's desired total)?
- Difficulty appropriate?
- Dog-friendly if required?
- Kid-friendly if required?
- Return time feasible given latestReturnTime?
- Weather acceptable given tolerance?
- Crowd level acceptable?
- Scenery matches preferences?

Return a JSON ARRAY:
{
  "trailId": number,
  "trailName": "string",
  "overallFit": "excellent" | "good" | "fair" | "poor",
  "confidenceScore": number (0-100),
  "passedChecks": ["Distance OK ✓", "Difficulty match ✓", etc.],
  "warnings": ["Moderate crowd expected", "No shade on ridge section", etc.],
  "risks": ["Weather risk: afternoon thunderstorms possible", etc.],
  "isRecommended": boolean
}

Be honest and specific. Flag real risks.
IMPORTANT: Set isRecommended true only when a trail clearly satisfies the user's hard constraints (distance, dog/kid needs, weather tolerance, return time). If none are a clear safe match, set isRecommended false for all — downstream deterministic rules will re-check and may still decline a primary pick. Your narrative and isRecommended are advisory; they do not override geometry or safety gates.
Respond ONLY with valid JSON array.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(cleanJsonResponse(text));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallbackValidationResults(candidates, intent);
    }

    const candidateIds = new Set(candidates.map((c) => c.trailId));
    const normalized = parsed
      .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
      .map((item) => {
        const trailId = parseFiniteNumber(item.trailId);
        if (trailId == null || !candidateIds.has(trailId)) return null;
        return {
          trailId,
          trailName: typeof item.trailName === 'string' ? item.trailName : String(trailId),
          overallFit:
            item.overallFit === 'excellent' ||
            item.overallFit === 'good' ||
            item.overallFit === 'fair' ||
            item.overallFit === 'poor'
              ? item.overallFit
              : 'good',
          confidenceScore: clamp(parseFiniteNumber(item.confidenceScore) ?? 70, 0, 100),
          passedChecks: Array.isArray(item.passedChecks)
            ? item.passedChecks.map((v) => String(v)).filter(Boolean)
            : [],
          warnings: Array.isArray(item.warnings)
            ? item.warnings.map((v) => String(v)).filter(Boolean)
            : [],
          risks: Array.isArray(item.risks)
            ? item.risks.map((v) => String(v)).filter(Boolean)
            : [],
          isRecommended: Boolean(item.isRecommended),
        } satisfies ValidationResult;
      })
      .filter((item): item is ValidationResult => item != null);

    if (normalized.length === 0) {
      return fallbackValidationResults(candidates, intent);
    }

    const missingCandidates = candidates.filter(
      (candidate) => !normalized.some((item) => item.trailId === candidate.trailId)
    );

    if (missingCandidates.length > 0) {
      normalized.push(...fallbackValidationResults(missingCandidates, intent));
    }

    return normalized;
  } catch (error) {
    console.error('[Validation Agent] Failed:', error);
    return fallbackValidationResults(candidates, intent);
  }
}

// ─── Agent 4: Action Agent ────────────────────────────────────────────

export async function runActionAgent(
  intent: IntentProfile,
  topCandidate: TrailCandidate,
  validation: ValidationResult,
  backupCandidate?: TrailCandidate,
  plannerNote?: string
): Promise<TripPlan> {
  const prompt = `You are the ACTION AGENT in a multi-agent outdoor planning system.

Your job: Generate a comprehensive, ACTION-ORIENTED trip plan for the trail the system selected as primary.
This trail already passed deterministic feasibility and safety gates. If plannerNote mentions elevated or alpine risk, emphasize conservative timing, gear, and turn-around judgment.
Even if the trail is not a perfect match subjectively, you MUST still provide a realistic, usable plan based on the data available. DO NOT return "N/A" for fields; use your best professional judgment to provide estimates.

${plannerNote ? `Planner note (deterministic): ${plannerNote}` : ''}

User Intent:
${JSON.stringify(intent, null, 2)}

Recommended Trail:
${JSON.stringify(topCandidate, null, 2)}

Validation Results:
${JSON.stringify(validation, null, 2)}

${backupCandidate ? `Backup Trail: ${JSON.stringify(backupCandidate, null, 2)}` : 'No backup trail available.'}

Return a JSON OBJECT:
{
  "recommendedTrailId": number,
  "recommendedTrailName": "string",
  "tripType": "day_hike" | "multi_day",
  "tripLengthDays": number,
  "whyChosen": "2-3 sentences explaining why this is THE best choice",
  "departureTime": "HH:MM AM/PM - when to leave home",
  "expectedReturnTime": "HH:MM AM/PM",
  "estimatedDuration": "For day hikes: Xh Ym on trail. For multi-day trips: total trip duration like '3 days / 2 nights'",
  "driveTime": "estimated one-way drive",
  "dailyPlan": ["For multi-day trips, one practical itinerary line per day. For day hikes, use 1 concise outing summary line."],
  "whatToBring": ["List of 4-6 specific items"],
  "safetyNotes": ["2-3 specific safety warnings"],
  "logisticsNotes": ["2-4 notes about permits, campsites, water, shuttles, or trailhead logistics"],
  "routeNotes": "2-3 sentences about the route",
  "weatherSummary": "Expected conditions (e.g. Partly cloudy, 55°F)",
  "conditionsSummary": "Trail conditions assessment (e.g. Well-maintained, likely wet)",
  "backupTrailId": number or 0,
  "backupTrailName": "string or 'None'",
  "backupReason": "When you might need the backup",
  "packingChecklist": ["5-8 items for a checkbox list"],
  "calendarTitle": "Short calendar event title",
  "calendarDescription": "Summary for calendar event",
  "shareableSummary": "Text summary for sharing with friends"
}

If intent.tripType is "multi_day", write this as a backpacking plan rather than a long day hike. Use realistic overnight logistics, a multi-day timeline, backpacking gear, and a trip-wide return time.

Respond ONLY with valid JSON. Do not use N/A. Provide realistic values.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const plan = JSON.parse(cleanJsonResponse(text));
    
    // Normalize array fields
    const ensureArray = (val: any) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
      return [];
    };

    plan.tripType = plan.tripType === 'multi_day' ? 'multi_day' : intent.tripType;
    plan.tripLengthDays = clamp(parseFiniteNumber(plan.tripLengthDays) ?? intent.tripLengthDays, 1, 14);
    plan.dailyPlan = ensureArray(plan.dailyPlan);
    plan.whatToBring = ensureArray(plan.whatToBring);
    plan.safetyNotes = ensureArray(plan.safetyNotes);
    plan.logisticsNotes = ensureArray(plan.logisticsNotes);
    plan.packingChecklist = ensureArray(plan.packingChecklist);

    return plan;
  } catch (error) {
    console.error('[Action Agent] Failed:', error);
    return {
      recommendedTrailId: topCandidate.trailId,
      recommendedTrailName: topCandidate.trailName,
      tripType: intent.tripType,
      tripLengthDays: intent.tripLengthDays,
      whyChosen: topCandidate.matchExplanation,
      departureTime: '8:00 AM',
      expectedReturnTime: intent.tripType === 'multi_day' ? '6:00 PM on final day' : '1:00 PM',
      estimatedDuration: intent.tripType === 'multi_day' ? `${intent.tripLengthDays} days` : '3-4 hours',
      driveTime: topCandidate.estimatedDriveTime,
      dailyPlan:
        intent.tripType === 'multi_day'
          ? Array.from({ length: intent.tripLengthDays }, (_, i) =>
              i === 0
                ? `Day 1: Drive in, start hiking early, and make steady progress toward a legal campsite.`
                : i === intent.tripLengthDays - 1
                  ? `Day ${i + 1}: Break camp early, complete the final miles, and return before evening weather builds.`
                  : `Day ${i + 1}: Cover a moderate day of trail with time for water, weather, and camp setup.`
            )
          : ['Drive to the trailhead, hike the recommended route, and return the same day.'],
      whatToBring:
        intent.tripType === 'multi_day'
          ? ['Water treatment', 'Shelter system', 'Insulation layers', 'Headlamp', 'First aid kit', 'Food for each day']
          : ['Water (2L)', 'Snacks', 'Sunscreen', 'Rain layer', 'First aid kit'],
      safetyNotes: ['Tell someone your plan', 'Check weather before departing'],
      logisticsNotes:
        intent.tripType === 'multi_day'
          ? ['Confirm overnight camping rules before departure.', 'Identify reliable water sources and backup campsites.']
          : ['Arrive early enough to secure parking at the trailhead.'],
      routeNotes: 'Follow the main trail. Watch for markers.',
      weatherSummary: topCandidate.weatherForecast,
      conditionsSummary: 'Check recent reports for current conditions.',
      backupTrailId: backupCandidate?.trailId || 0,
      backupTrailName: backupCandidate?.trailName || 'None',
      backupReason: 'If primary trail is too crowded or conditions deteriorate.',
      packingChecklist:
        intent.tripType === 'multi_day'
          ? ['Pack', 'Shelter', 'Sleep system', 'Food', 'Water treatment', 'Map', 'Headlamp', 'Phone (charged)']
          : ['Water', 'Snacks', 'Map', 'Sunscreen', 'First aid', 'Phone (charged)'],
      calendarTitle: intent.tripType === 'multi_day' ? `Backpacking: ${topCandidate.trailName}` : `Hike: ${topCandidate.trailName}`,
      calendarDescription:
        intent.tripType === 'multi_day'
          ? `Trail: ${topCandidate.trailName}\nTrip length: ${intent.tripLengthDays} days\n${topCandidate.matchExplanation}`
          : `Trail: ${topCandidate.trailName}\nDuration: ~3-4h\n${topCandidate.matchExplanation}`,
      shareableSummary: `Heading to ${topCandidate.trailName}! ${topCandidate.matchExplanation}`
    };
  }
}

// ─── Legacy support (used by existing code) ────────────────────────────

export interface RecommendationPreferences {
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'extreme';
  maxDistance?: number;
  tripType?: TripType;
  /**
   * Multi-day searches should not silently recommend short day-hike segments as valid treks.
   * When true, the deterministic scorer may still return the best public-data candidates as
   * context so the planner can show explicit gate failures instead of a fatal empty-results toast.
   */
  allowMultiDayContextFallback?: boolean;
  terrain?: string[];
  features?: string[];
  reasoning: string;
  locationQuery: string;
  estimatedRegionName: string;
  bbox?: BoundingBox;
}

export function intentToLegacyPrefs(intent: IntentProfile): RecommendationPreferences {
  const diffMap: Record<string, 'beginner' | 'intermediate' | 'advanced' | 'extreme'> = {
    easy: 'beginner',
    moderate: 'intermediate',
    hard: 'advanced',
    expert: 'extreme'
  };
  return {
    difficulty: diffMap[intent.difficulty] || 'intermediate',
    maxDistance: intent.searchDistanceKm,
    tripType: intent.tripType,
    terrain: [],
    features: intent.sceneryPreferences,
    reasoning: intent.reasoning,
    locationQuery: intent.location,
    estimatedRegionName: intent.estimatedRegionName,
    bbox: intent.bbox
  };
}
