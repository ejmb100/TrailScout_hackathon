const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanJsonResponse(text) {
  return String(text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function statusFromGeminiError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('429') || /quota|rate/i.test(message)) return 429;
  return 502;
}

function errorPayload(error) {
  const status = statusFromGeminiError(error);
  return {
    status,
    text: JSON.stringify({
      error: status === 429 ? 'Gemini quota exceeded' : 'Gemini request failed',
      fallbackReason: status === 429 ? 'quota_or_rate_limit' : 'server_gemini_error',
    }),
  };
}

async function generateJson(prompt) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      status: 503,
      text: JSON.stringify({
        error: 'GEMINI_API_KEY not configured on server',
        fallbackReason: 'missing_server_key',
      }),
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return { status: 200, value: JSON.parse(cleanJsonResponse(text)) };
  } catch (error) {
    console.warn('[gemini-proxy] request failed:', error);
    return errorPayload(error);
  }
}

function intentPrompt(userRequest) {
  const today = new Date().toISOString().split('T')[0];
  return `You are the INTENT AGENT in TrailScout, an intent-based hiking and backpacking planner.

Today's date: ${today}

USER REQUEST: "${userRequest}"

Return ONLY valid JSON:
{
  "location": "specific place/region",
  "activity": "hiking" | "backpacking",
  "date": "YYYY-MM-DD or today/tomorrow/month",
  "month": "month name if named",
  "difficulty": "easy" | "moderate" | "hard" | "expert",
  "tripType": "day_hike" | "multi_day",
  "tripLengthDays": number,
  "durationDays": number,
  "overnightRequired": boolean,
  "routeType": "loop" | "out_and_back" | "point_to_point" | "unspecified",
  "campsiteSupportRequired": boolean,
  "permitCheckRequired": boolean,
  "seasonalityCheckRequired": boolean,
  "snowRiskCheckRequired": boolean,
  "accessCheckRequired": boolean,
  "maxDistanceKm": number,
  "dailyDistanceKm": number,
  "searchDistanceKm": number,
  "elevationPreference": "flat" | "rolling" | "steep" | "any",
  "sceneryPreferences": ["lake", "forest", "mountain", "waterfall", "ridge", "meadow", "river"],
  "crowdPreference": "low" | "moderate" | "any",
  "dogFriendly": boolean,
  "kidFriendly": boolean,
  "weatherTolerance": "fair_only" | "light_rain_ok" | "any",
  "latestReturnTime": "HH:MM or none",
  "driveTimeTolerance": "< 30 min" | "< 1 hour" | "< 2 hours" | "any",
  "reasoning": "2-3 sentences",
  "estimatedRegionName": "Human-readable region",
  "bbox": { "minLat": number, "maxLat": number, "minLon": number, "maxLon": number },
  "followUpQuestions": []
}

Rules:
- Multi-day hiking language like "four-day hiking trail" or "two-night hike" implies backpacking, overnightRequired=true, campsiteSupportRequired=true, permitCheckRequired=true, seasonalityCheckRequired=true, and accessCheckRequired=true.
- For mountain/high-elevation regions, set snowRiskCheckRequired=true.
- maxDistanceKm is the desired total outing distance when stated; searchDistanceKm should be a substantial route-discovery target for multi-day trips.
- Keep bbox proportional to route discovery, not statewide.`;
}

function researchPrompt(intent, trails) {
  return `You are the RESEARCH AGENT in TrailScout.

Intent:
${JSON.stringify(intent, null, 2)}

Candidate public-data trails:
${JSON.stringify((trails || []).slice(0, 20), null, 2)}

Return ONLY a JSON ARRAY, max 5:
{
  "trailId": number,
  "trailName": "string",
  "matchScore": number,
  "matchExplanation": "2-3 sentences covering distance fit, terrain, source uncertainty, campsite/season concerns",
  "estimatedDriveTime": "estimate from region center",
  "weatherForecast": "short realistic summary",
  "crowdLevel": "low" | "moderate" | "high",
  "bestTimeToGo": "start time",
  "sceneryHighlights": ["features"],
  "trailImageQuery": "photo search query"
}

For multi-day trips, compare distance primarily to intent.searchDistanceKm and be honest when a trail is too short.`;
}

function actionPrompt(body) {
  const { intent, topCandidate, validation, backupCandidate, plannerNote } = body || {};
  return `You are the ACTION AGENT in TrailScout. Generate a practical hiking/backpacking trip plan.

Planner note: ${plannerNote || 'none'}

Intent:
${JSON.stringify(intent, null, 2)}

Selected trail:
${JSON.stringify(topCandidate, null, 2)}

Validation:
${JSON.stringify(validation, null, 2)}

Backup:
${backupCandidate ? JSON.stringify(backupCandidate, null, 2) : 'none'}

Return ONLY a JSON OBJECT:
{
  "recommendedTrailId": number,
  "recommendedTrailName": "string",
  "tripType": "day_hike" | "multi_day",
  "tripLengthDays": number,
  "whyChosen": "2-3 sentences",
  "departureTime": "HH:MM AM/PM",
  "expectedReturnTime": "HH:MM AM/PM or final-day time",
  "estimatedDuration": "duration",
  "driveTime": "estimated one-way drive",
  "dailyPlan": ["one line per day or one day-hike summary"],
  "whatToBring": ["4-6 items"],
  "safetyNotes": ["2-3 warnings"],
  "logisticsNotes": ["permits/campsites/water/shuttle notes"],
  "routeNotes": "2-3 sentences",
  "weatherSummary": "summary",
  "conditionsSummary": "summary",
  "backupTrailId": number,
  "backupTrailName": "string",
  "backupReason": "string",
  "packingChecklist": ["5-8 items"],
  "calendarTitle": "short title",
  "calendarDescription": "calendar summary",
  "shareableSummary": "share text"
}

If intent.tripType is multi_day, write this as backpacking, not a long day hike. Do not use N/A.`;
}

module.exports = {
  generateJson,
  intentPrompt,
  researchPrompt,
  actionPrompt,
};
