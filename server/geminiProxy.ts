import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export interface GeminiProxyResult {
  status: number;
  text: string;
}

function cleanJsonResponse(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function errorStatus(error: unknown): number {
  const message = String((error as { message?: string })?.message || error || '');
  return message.includes('429') || /quota|rate/i.test(message) ? 429 : 502;
}

async function generateJson(prompt: string, apiKey: string): Promise<GeminiProxyResult> {
  if (!apiKey.trim()) {
    return {
      status: 503,
      text: JSON.stringify({ error: 'GEMINI_API_KEY not configured on server', fallbackReason: 'missing_server_key' }),
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const value = JSON.parse(cleanJsonResponse(result.response.text()));
    return { status: 200, text: JSON.stringify(value) };
  } catch (error) {
    console.warn('[gemini-proxy] request failed:', error);
    const status = errorStatus(error);
    return {
      status,
      text: JSON.stringify({
        error: status === 429 ? 'Gemini quota exceeded' : 'Gemini request failed',
        fallbackReason: status === 429 ? 'quota_or_rate_limit' : 'server_gemini_error',
      }),
    };
  }
}

function intentPrompt(userRequest: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are the INTENT AGENT in TrailScout. Today is ${today}.
Parse this hiking/backpacking request into ONLY valid JSON with location, activity, date, month, difficulty, tripType, tripLengthDays, durationDays, overnightRequired, routeType, campsiteSupportRequired, permitCheckRequired, seasonalityCheckRequired, snowRiskCheckRequired, accessCheckRequired, maxDistanceKm, dailyDistanceKm, searchDistanceKm, elevationPreference, sceneryPreferences, crowdPreference, dogFriendly, kidFriendly, weatherTolerance, latestReturnTime, driveTimeTolerance, reasoning, estimatedRegionName, bbox, followUpQuestions.
Multi-day hiking such as "four-day hiking trail" implies backpacking and overnight/campsite/permit/seasonality/access checks.
Request: "${userRequest}"`;
}

function researchPrompt(intent: unknown, trails: unknown): string {
  return `You are the RESEARCH AGENT in TrailScout. Return ONLY a JSON ARRAY of up to 5 trail candidates with trailId, trailName, matchScore, matchExplanation, estimatedDriveTime, weatherForecast, crowdLevel, bestTimeToGo, sceneryHighlights, trailImageQuery.
Intent: ${JSON.stringify(intent)}
Trails: ${JSON.stringify(trails)}
For multi-day trips, be honest about route length mismatch and source uncertainty.`;
}

function actionPrompt(body: Record<string, unknown>): string {
  return `You are the ACTION AGENT in TrailScout. Return ONLY a JSON OBJECT trip plan with recommendedTrailId, recommendedTrailName, tripType, tripLengthDays, whyChosen, departureTime, expectedReturnTime, estimatedDuration, driveTime, dailyPlan, whatToBring, safetyNotes, logisticsNotes, routeNotes, weatherSummary, conditionsSummary, backupTrailId, backupTrailName, backupReason, packingChecklist, calendarTitle, calendarDescription, shareableSummary.
If multi_day, write as backpacking. Data: ${JSON.stringify(body)}`;
}

export async function queryGeminiRoute(
  route: 'intent' | 'research' | 'action',
  body: Record<string, unknown>,
  apiKey: string,
): Promise<GeminiProxyResult> {
  const prompt =
    route === 'intent'
      ? intentPrompt(String(body.userRequest || ''))
      : route === 'research'
        ? researchPrompt(body.intent, body.trails)
        : actionPrompt(body);

  const result = await generateJson(prompt, apiKey);
  if (result.status !== 200) return result;

  const key = route === 'intent' ? 'profile' : route === 'research' ? 'candidates' : 'plan';
  return {
    status: 200,
    text: JSON.stringify({ [key]: JSON.parse(result.text) }),
  };
}
