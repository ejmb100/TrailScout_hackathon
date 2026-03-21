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

export interface IntentProfile {
  location: string;
  date: string;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  maxDistanceKm: number;
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
  whyChosen: string;
  departureTime: string;
  expectedReturnTime: string;
  estimatedDuration: string;
  driveTime: string;
  whatToBring: string[] | string;
  safetyNotes: string[] | string;
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
    maxDistanceKm: 10,
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
  const bbox = normalizeBBox(data.bbox, region.bbox, maxDistanceKm);

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
    maxDistanceKm,
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
  "maxDistanceKm": number (convert miles to km if needed. 1 mile = 1.60934 km). This is the user's desired TOTAL hike length for the outing (out-and-back, loop, or one-way as they described),
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

For the bbox: Make it proportional to the desired hike distance. For 10+ km hikes, use 0.15-0.3 degree spread. For shorter walks, 0.05-0.1.
If no location specified, choose a spectacular hiking destination and explain why.

maxDistanceKm must reflect the full hike the user asked for (e.g. "10 mile hike" -> ~16 km). Do not understate this number.

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

export function fallbackValidationResults(candidates: TrailCandidate[]): ValidationResult[] {
  return candidates.map((c, i) => {
    const dist = c.distanceKm ?? 0;
    const ratio = intentRatio(dist, 1);
    return {
      trailId: c.trailId,
      trailName: c.trailName,
      overallFit: i === 0 ? 'excellent' : i < 3 ? 'good' : ratio >= 0.35 ? 'fair' : 'poor',
      confidenceScore: Math.max(55, 85 - i * 10),
      passedChecks: [
        dist > 0 ? `Mapped trail length available (${dist.toFixed(1)} km).` : 'Basic trail data available.',
        'Fallback validation used because model output was incomplete.',
      ],
      warnings: dist > 0 ? [] : ['Trail length estimate is limited.'],
      risks: ['Review current conditions before you go.'],
      isRecommended: i < 3,
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

CRITICAL LENGTH RULE: intent.maxDistanceKm is the user's desired total hike distance. Each trail's distanceKm is the length of the mapped OSM geometry (full route relation when available, otherwise a named way segment). If distanceKm is far below maxDistanceKm (e.g. under ~35% of maxDistanceKm), treat as a poor length match unless tags indicate trailscout_source osm_relation and the geometry plausibly matches the request. Prefer trails with distanceKm reasonably close to maxDistanceKm (roughly 50%–130%). Mention length mismatch honestly in matchExplanation when the trail is much shorter than requested.

When present, use elevationGainM and elevationLossM (meters, sampled along the trail: USGS 3DEP in the United States, otherwise coarse global DEM) in match explanations and difficulty context.

For each trail (up to the top 5 best matches), produce a research analysis:
{
  "trailId": number,
  "trailName": "string",
  "matchScore": number (0-100, how well it matches the intent),
  "matchExplanation": "1-2 sentences explaining why this trail fits the request",
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

Each candidate may include distanceKm (mapped OpenStreetMap path length in km). Compare distanceKm to intent.maxDistanceKm. If distanceKm is far below maxDistanceKm, lower overallFit, add warnings, and note the mismatch in passedChecks or warnings. If distanceKm is missing, infer cautiously from trailName and matchExplanation.

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

Be honest and specific. Flag real risks. At least 1 trail should be recommended.
Respond ONLY with valid JSON array.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(cleanJsonResponse(text));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallbackValidationResults(candidates);
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
      return fallbackValidationResults(candidates);
    }

    const missingCandidates = candidates.filter(
      (candidate) => !normalized.some((item) => item.trailId === candidate.trailId)
    );

    if (missingCandidates.length > 0) {
      normalized.push(...fallbackValidationResults(missingCandidates));
    }

    if (!normalized.some((item) => item.isRecommended) && normalized.length > 0) {
      normalized[0] = { ...normalized[0], isRecommended: true };
    }

    return normalized;
  } catch (error) {
    console.error('[Validation Agent] Failed:', error);
    return fallbackValidationResults(candidates);
  }
}

// ─── Agent 4: Action Agent ────────────────────────────────────────────

export async function runActionAgent(
  intent: IntentProfile,
  topCandidate: TrailCandidate,
  validation: ValidationResult,
  backupCandidate?: TrailCandidate
): Promise<TripPlan> {
  const prompt = `You are the ACTION AGENT in a multi-agent outdoor planning system.

Your job: Generate a comprehensive, ACTION-ORIENTED trip plan for the recommended trail.
Even if the trail is not a perfect match (e.g. "poor fit"), you MUST still provide a realistic, usable plan based on the data available. DO NOT return "N/A" for fields; use your best professional judgment to provide estimates.

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
  "whyChosen": "2-3 sentences explaining why this is THE best choice",
  "departureTime": "HH:MM AM/PM - when to leave home",
  "expectedReturnTime": "HH:MM AM/PM",
  "estimatedDuration": "Xh Ym on trail",
  "driveTime": "estimated one-way drive",
  "whatToBring": ["List of 4-6 specific items"],
  "safetyNotes": ["2-3 specific safety warnings"],
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

    plan.whatToBring = ensureArray(plan.whatToBring);
    plan.safetyNotes = ensureArray(plan.safetyNotes);
    plan.packingChecklist = ensureArray(plan.packingChecklist);

    return plan;
  } catch (error) {
    console.error('[Action Agent] Failed:', error);
    return {
      recommendedTrailId: topCandidate.trailId,
      recommendedTrailName: topCandidate.trailName,
      whyChosen: topCandidate.matchExplanation,
      departureTime: '8:00 AM',
      expectedReturnTime: '1:00 PM',
      estimatedDuration: '3-4 hours',
      driveTime: topCandidate.estimatedDriveTime,
      whatToBring: ['Water (2L)', 'Snacks', 'Sunscreen', 'Rain layer', 'First aid kit'],
      safetyNotes: ['Tell someone your plan', 'Check weather before departing'],
      routeNotes: 'Follow the main trail. Watch for markers.',
      weatherSummary: topCandidate.weatherForecast,
      conditionsSummary: 'Check recent reports for current conditions.',
      backupTrailId: backupCandidate?.trailId || 0,
      backupTrailName: backupCandidate?.trailName || 'None',
      backupReason: 'If primary trail is too crowded or conditions deteriorate.',
      packingChecklist: ['Water', 'Snacks', 'Map', 'Sunscreen', 'First aid', 'Phone (charged)'],
      calendarTitle: `Hike: ${topCandidate.trailName}`,
      calendarDescription: `Trail: ${topCandidate.trailName}\nDuration: ~3-4h\n${topCandidate.matchExplanation}`,
      shareableSummary: `Heading to ${topCandidate.trailName}! ${topCandidate.matchExplanation}`
    };
  }
}

// ─── Legacy support (used by existing code) ────────────────────────────

export interface RecommendationPreferences {
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'extreme';
  maxDistance?: number;
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
    maxDistance: intent.maxDistanceKm,
    terrain: [],
    features: intent.sceneryPreferences,
    reasoning: intent.reasoning,
    locationQuery: intent.location,
    estimatedRegionName: intent.estimatedRegionName,
    bbox: intent.bbox
  };
}
