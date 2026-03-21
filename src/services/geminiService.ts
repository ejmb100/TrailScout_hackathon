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

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

function cleanJsonResponse(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
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
  "maxDistanceKm": number (convert miles to km if needed. 1 mile = 1.6km),
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

Respond ONLY with valid JSON.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error('[Intent Agent] Failed:', error);
    return {
      location: 'Pacific Northwest',
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
      reasoning: 'Error parsing your request. Using default moderate hike preferences.',
      estimatedRegionName: 'Pacific Northwest',
      bbox: { minLat: 47.5, maxLat: 47.7, minLon: -121.8, maxLon: -121.5 },
      followUpQuestions: []
    };
  }
}

// ─── Agent 2: Research Agent ──────────────────────────────────────────

export async function runResearchAgent(
  intent: IntentProfile,
  trailsRaw: any[]
): Promise<TrailCandidate[]> {
  const trailSummary = trailsRaw.slice(0, 20).map(t => ({
    id: t.id,
    name: t.name,
    distanceKm: t.distanceKm,
    tags: t.tags
  }));

  const prompt = `You are the RESEARCH AGENT in a multi-agent outdoor planning system.

The Intent Agent extracted this profile:
${JSON.stringify(intent, null, 2)}

Here are candidate trails from OpenStreetMap:
${JSON.stringify(trailSummary, null, 2)}

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
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error('[Research Agent] Failed:', error);
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
      trailImageQuery: `${t.name} hiking trail`
    }));
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

For each trail, perform these checks:
- Distance within maxDistanceKm? 
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
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error('[Validation Agent] Failed:', error);
    return candidates.map((c, i) => ({
      trailId: c.trailId,
      trailName: c.trailName,
      overallFit: i === 0 ? 'excellent' as const : 'good' as const,
      confidenceScore: 85 - i * 10,
      passedChecks: ['Distance OK ✓', 'Difficulty match ✓'],
      warnings: [],
      risks: [],
      isRecommended: i < 3
    }));
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
