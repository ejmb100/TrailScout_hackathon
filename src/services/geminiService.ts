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
  activity?: 'hiking' | 'backpacking';
  location: string;
  date: string;
  month?: string;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  tripType: TripType;
  tripLengthDays: number;
  durationDays?: number;
  overnightRequired?: boolean;
  routeType?: 'loop' | 'out_and_back' | 'point_to_point' | 'unspecified';
  campsiteSupportRequired?: boolean;
  permitCheckRequired?: boolean;
  seasonalityCheckRequired?: boolean;
  snowRiskCheckRequired?: boolean;
  accessCheckRequired?: boolean;
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

// Gemini calls are routed through same-origin serverless endpoints so the API key
// never ships in the browser bundle. Missing/quota-limited server keys fall back
// to deterministic client behavior below.
export const isGeminiApiKeyConfigured = true;

async function postGeminiEndpoint<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data?.error || `Gemini endpoint ${path} failed with HTTP ${response.status}`;
    const hint = data?.fallbackReason ? ` (${data.fallbackReason})` : '';
    throw new Error(`${error}${hint}`);
  }
  return data as T;
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

  const wordDays: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)[-\s]*(?:day|night)\b/);
  if (word) {
    return clamp(wordDays[word[1]], 1, 14);
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

function inferActivity(tripType: TripType, locationHint?: string): IntentProfile['activity'] {
  const text = String(locationHint || '').toLowerCase();
  if (tripType === 'multi_day' || /\bbackpack(?:ing)?\b|\bovernight\b|\btwo-night\b|\b\d+\s*night\b/.test(text)) {
    return 'backpacking';
  }
  return 'hiking';
}

function inferRouteType(raw: unknown, locationHint?: string): NonNullable<IntentProfile['routeType']> {
  if (raw === 'loop' || raw === 'out_and_back' || raw === 'point_to_point' || raw === 'unspecified') return raw;
  const text = String(locationHint || '').toLowerCase();
  if (/\bloop\b/.test(text)) return 'loop';
  if (/\bout[- ]?and[- ]?back\b/.test(text)) return 'out_and_back';
  if (/\bpoint[- ]?to[- ]?point\b|\bone[- ]?way\b|\bthru\b/.test(text)) return 'point_to_point';
  return 'unspecified';
}

function inferMonth(raw: unknown, date: string, locationHint?: string): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const text = `${date} ${locationHint || ''}`.toLowerCase();
  const match = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
  if (match) return match[1];
  const iso = date.match(/^\d{4}-(\d{2})-/);
  if (!iso) return undefined;
  const monthIdx = Number(iso[1]) - 1;
  const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return names[monthIdx];
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
  const tripLengthDays = inferTripLengthDays({}, locationHint);
  const tripType = inferTripType({}, tripLengthDays, locationHint);
  const date = 'today';
  return {
    activity: inferActivity(tripType, locationHint),
    location: region.location,
    date,
    month: inferMonth(undefined, date, locationHint),
    difficulty: 'moderate',
    tripType,
    tripLengthDays,
    durationDays: tripLengthDays,
    overnightRequired: tripType === 'multi_day',
    routeType: inferRouteType(undefined, locationHint),
    campsiteSupportRequired: tripType === 'multi_day',
    permitCheckRequired: tripType === 'multi_day',
    seasonalityCheckRequired: true,
    snowRiskCheckRequired: /colorado|alpine|high[- ]?elevation|mountain|snow/i.test(locationHint || ''),
    accessCheckRequired: true,
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
  const activity = data.activity === 'backpacking' || data.activity === 'hiking'
    ? data.activity
    : inferActivity(tripType, locationHint);
  const date = typeof data.date === 'string' && data.date.trim() ? data.date.trim() : fallback.date;
  const overnightRequired = data.overnightRequired != null
    ? Boolean(data.overnightRequired)
    : tripType === 'multi_day';
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
    activity,
    location: typeof data.location === 'string' && data.location.trim() ? data.location.trim() : region.location,
    date,
    month: inferMonth(data.month, date, locationHint),
    difficulty,
    tripType,
    tripLengthDays,
    durationDays: tripLengthDays,
    overnightRequired,
    routeType: inferRouteType(data.routeType, locationHint),
    campsiteSupportRequired: data.campsiteSupportRequired != null
      ? Boolean(data.campsiteSupportRequired)
      : overnightRequired,
    permitCheckRequired: data.permitCheckRequired != null
      ? Boolean(data.permitCheckRequired)
      : overnightRequired,
    seasonalityCheckRequired: data.seasonalityCheckRequired != null
      ? Boolean(data.seasonalityCheckRequired)
      : true,
    snowRiskCheckRequired: data.snowRiskCheckRequired != null
      ? Boolean(data.snowRiskCheckRequired)
      : /colorado|alpine|high[- ]?elevation|mountain|snow/i.test(`${region.location} ${region.estimatedRegionName} ${locationHint || ''}`),
    accessCheckRequired: data.accessCheckRequired != null
      ? Boolean(data.accessCheckRequired)
      : true,
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

export { normalizeIntentProfile };

// ─── Agent 1: Intent Agent ────────────────────────────────────────────

export async function runIntentAgent(userRequest: string): Promise<IntentProfile> {
  try {
    const result = await postGeminiEndpoint<{ profile: unknown }>('/api/gemini-intent', { userRequest });
    return normalizeIntentProfile(result.profile, userRequest);
  } catch (error) {
    console.warn('[Intent Agent] Server Gemini unavailable; using fallback profile:', error);
    return buildDefaultIntentProfile(
      'Gemini intent parsing was unavailable or quota-limited, so TrailScout used deterministic fallback preferences.',
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

  try {
    const result = await postGeminiEndpoint<{ candidates: unknown }>('/api/gemini-research', { intent, trails: trailSummary });
    const parsed = result.candidates;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallbackResearchCandidates(trailsRaw);
    }
    return parsed;
  } catch (error) {
    console.warn('[Research Agent] Server Gemini unavailable; using fallback candidates:', error);
    return fallbackResearchCandidates(trailsRaw);
  }
}

// ─── Agent 3: Validation Agent ────────────────────────────────────────

export async function runValidationAgent(
  intent: IntentProfile,
  candidates: TrailCandidate[]
): Promise<ValidationResult[]> {
  return fallbackValidationResults(candidates, intent);
}

// ─── Agent 4: Action Agent ────────────────────────────────────────────

export async function runActionAgent(
  intent: IntentProfile,
  topCandidate: TrailCandidate,
  validation: ValidationResult,
  backupCandidate?: TrailCandidate,
  plannerNote?: string
): Promise<TripPlan> {
  try {
    const result = await postGeminiEndpoint<{ plan: any }>('/api/gemini-action', {
      intent,
      topCandidate,
      validation,
      backupCandidate,
      plannerNote,
    });
    const plan = result.plan;
    
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
    console.warn('[Action Agent] Server Gemini unavailable; using fallback plan:', error);
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
