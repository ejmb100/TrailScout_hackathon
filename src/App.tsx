/**
 * TrailScout — Multi-Agent Outdoor Planning Engine
 * 
 * Architecture:
 *   Agent 1: Intent Agent (parses NL → structured profile)
 *   Agent 2: Research Agent (enriches trails with context)
 *   Agent 3: Validation Agent (validates against constraints)
 *   Agent 4: Action Agent (generates trip plan)
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Compass,
  Map as MapIcon,
  ArrowRight,
  Menu,
  X,
  Mountain,
  Wind,
  Gauge,
  Ruler,
  Brain,
  Search,
  ShieldCheck,
  Zap,
  Sparkles,
  CloudRain,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import AgentWorkflow from './components/AgentWorkflow';
import type { AgentStage } from './components/AgentWorkflow';
import TrailResultCard from './components/TrailResultCard';
import TripPlanView from './components/TripPlanView';
import MapContainer from './components/MapContainer';

import {
  runIntentAgent,
  runResearchAgent,
  runActionAgent,
  intentToLegacyPrefs,
  isGeminiApiKeyConfigured,
  fallbackResearchCandidates,
  fallbackValidationResults,
  type IntentProfile,
  type TrailCandidate,
  type ValidationResult,
  type TripPlan,
} from './services/geminiService';
import { fetchTrailsWithFallback, type TrailData } from './services/osmService';
import { enrichTrailsWithElevation } from './services/elevationService';
import { fetchForecastForHike, type HikeForecast } from './services/weatherService';
import { fetchApproxIpLocation, type ApproxIpLocation } from './services/ipGeoService';
import { scoreAndFilterTrails, calculateDistance, effectiveTrailDistanceKm, computeDeterministicMatchScore } from './utils/trailScoring';
import { fetchOfficialTrailsInBBox, getOfficialTrailCount, getDataVintage } from './services/officialTrailService';
import { fetchCotrexTrailsInBBox } from './services/cotrexService';
import { fetchCampsitesInBBox } from './services/campsiteService';
import { buildMultiDayRouteCandidates } from './services/routeBuilder';
import { mergeTrailSources } from './services/trailMergeService';
import {
  integratePlanner,
  buildDeclinedTripPlan,
  buildMultiDayItinerary,
  estimateEffort,
  type PlannerRecommendation,
  type PlannerScoredCandidate,
  type MultiDayItinerary,
  type EffortEstimate,
  type AssumptionEntry,
} from './planner';
import { buildTravelPlan, type TravelPlan } from './services/travelLogisticsService';
import { fetchRidbFacilities } from './services/recreationGovService';
import { fetchForestAlerts, type ForestAlerts } from './services/forestAlertService';
import {
  buildCampsiteStatuses,
  type CampsiteStatus,
} from './services/campsiteStatusService';

// ─── Screen types ─────────────────────────────────────────────────────

type AppScreen = 'home' | 'workflow' | 'results' | 'plan';

function widenBBox(
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
  factor: number
) {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLon = (bbox.minLon + bbox.maxLon) / 2;
  const halfLat = ((bbox.maxLat - bbox.minLat) / 2) * factor;
  const halfLon = ((bbox.maxLon - bbox.minLon) / 2) * factor;

  return {
    minLat: Math.max(-85, centerLat - halfLat),
    maxLat: Math.min(85, centerLat + halfLat),
    minLon: Math.max(-180, centerLon - halfLon),
    maxLon: Math.min(180, centerLon + halfLon),
  };
}

// ─── Prompt chips ─────────────────────────────────────────────────────

const promptChips = [
  "I'm visiting Seattle tomorrow and want a moderate hike with lake views, under 7 miles, dog-friendly, back by 2pm",
  "A challenging ridge walk in the Swiss Alps with stunning panoramic views, 15+ km",
  "Easy family hike near Portland with waterfalls, kid-friendly, under 4 miles",
  "I want a quiet forest trail near Asheville NC, no crowds, moderate difficulty",
  "Weekend day hike near Denver with wildflowers and mountain views, 8-10 miles",
  "A ten mile hike in Colorado with mountain views, moderate difficulty",
  "Day hike near Rocky Mountain National Park, 6–8 miles, alpine scenery",
];

/** Shown in the search dropdown and as bottom chips — keep in sync for UX. */
const allExamplePrompts = [...promptChips];

// ─── Navbar ───────────────────────────────────────────────────────────

const Navbar: React.FC<{ onLogoClick: () => void }> = ({ onLogoClick }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 bg-navy/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
        <button onClick={onLogoClick} className="flex items-center gap-2.5 group">
          <div className="bg-teal/20 group-hover:bg-teal/30 p-2 rounded-xl transition-colors">
            <Compass className="text-teal w-5 h-5" />
          </div>
          <div>
            <span className="font-display font-bold text-lg tracking-tight text-offwhite block leading-none">
              TrailScout
            </span>
            <span className="text-[9px] text-teal/70 uppercase tracking-[0.2em] font-semibold">
              Multi-Agent Engine
            </span>
          </div>
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className="text-sm text-offwhite/50 hover:text-teal transition-colors">How it Works</a>
          <div className="flex items-center gap-1.5 bg-teal/10 px-3 py-1.5 rounded-full border border-teal/20">
            <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
            <span className="text-[10px] text-teal font-semibold uppercase tracking-wider">4 Agents Online</span>
          </div>
        </div>

        <button className="md:hidden text-offwhite/70" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-white/5 bg-navy/95 backdrop-blur-xl"
          >
            <div className="px-6 py-4 space-y-3">
              <a href="#how-it-works" className="block text-offwhite/60 py-2" onClick={() => setIsOpen(false)}>How it Works</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// ─── Main App ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

export default function App() {
  // Screen state
  const [screen, setScreen] = useState<AppScreen>('home');
  
  // Input state
  const [intent, setIntent] = useState('');
  const [tripMode, setTripMode] = useState<'day' | 'multi'>('day');
  const [tripDays, setTripDays] = useState(3);

  // Agent pipeline state
  const [agentStage, setAgentStage] = useState<AgentStage>('idle');
  const [intentProfile, setIntentProfile] = useState<IntentProfile | null>(null);
  const [trails, setTrails] = useState<TrailData[]>([]);
  const [candidates, setCandidates] = useState<TrailCandidate[]>([]);
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [tripPlan, setTripPlan] = useState<TripPlan | null>(null);
  const [multiDayItinerary, setMultiDayItinerary] = useState<MultiDayItinerary | null>(null);
  const [travelPlan, setTravelPlan] = useState<TravelPlan | null>(null);
  const [selectedTrailIndex, setSelectedTrailIndex] = useState(0);

  // Agent summaries for the workflow display
  const [intentSummary, setIntentSummary] = useState('');
  const [researchSummary, setResearchSummary] = useState('');
  const [validationSummary, setValidationSummary] = useState('');
  const [actionSummary, setActionSummary] = useState('');

  // Error state
  const [error, setError] = useState('');

  /** Open-Meteo forecast for hike area (set after intent). */
  const [hikeForecast, setHikeForecast] = useState<HikeForecast | null>(null);
  /** Deterministic planner outcome (gates, primary id, banners). */
  const [plannerRecommendation, setPlannerRecommendation] = useState<PlannerRecommendation | null>(null);
  /** Whether official USFS trails contributed to the current search. */
  const [hasOfficialTrails, setHasOfficialTrails] = useState(false);
  const [plannerByTrailId, setPlannerByTrailId] = useState<Map<number, PlannerScoredCandidate> | null>(null);
  /** Coarse IP-based location for default map center (VPN may skew). */
  const [approxUserLocation, setApproxUserLocation] = useState<ApproxIpLocation | null>(null);
  /** True while we're re-running the Action Agent for a newly selected trail. */
  const [rebuildingPlan, setRebuildingPlan] = useState(false);
  /** Fused campsite statuses from EDW + RIDB + fire alerts. */
  const [campsiteStatuses, setCampsiteStatuses] = useState<CampsiteStatus[]>([]);
  /** Active fire/closure alerts for the search area. */
  const [forestAlerts, setForestAlerts] = useState<ForestAlerts | null>(null);
  /** Aggregated assumptions from all pipeline stages. */
  const [assumptionLedger, setAssumptionLedger] = useState<AssumptionEntry[]>([]);
  /** Effort estimate for the primary/selected trail. */
  const [effortEstimate, setEffortEstimate] = useState<EffortEstimate | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const searchShellRef = useRef<HTMLDivElement>(null);

  /** Example-search panel: opens on input focus or explicit control (reliable vs. focus-only). */
  const [examplesMenuOpen, setExamplesMenuOpen] = useState(false);

  const intentSuggestions = useMemo(() => {
    const q = intent.trim().toLowerCase();
    if (q.length < 2) {
      return allExamplePrompts.slice(0, 8);
    }
    const hits = allExamplePrompts.filter((p) => p.toLowerCase().includes(q));
    return hits.length > 0 ? hits.slice(0, 8) : allExamplePrompts.slice(0, 5);
  }, [intent]);

  useEffect(() => {
    if (!examplesMenuOpen) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      const el = searchShellRef.current;
      if (el && !el.contains(e.target as Node)) {
        setExamplesMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [examplesMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    fetchApproxIpLocation().then((loc) => {
      if (!cancelled && loc) setApproxUserLocation(loc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Build query with filters ─────────────────────────────────────
  
  const buildQuery = (): string => {
    return intent.trim();
  };

  // ─── Run the multi-agent pipeline ─────────────────────────────────
  
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = buildQuery();
    if (!query) return;

    if (!isGeminiApiKeyConfigured) {
      setError(
        'Missing Gemini API key. Add GEMINI_API_KEY or VITE_GEMINI_API_KEY to your .env file, then restart the dev server.'
      );
      return;
    }

    setError('');
    setScreen('workflow');
    setAgentStage('idle');
    setCandidates([]);
    setValidations([]);
    setTripPlan(null);
    setMultiDayItinerary(null);
    setTravelPlan(null);
    setSelectedTrailIndex(0);
    setIntentSummary('');
    setResearchSummary('');
    setValidationSummary('');
    setActionSummary('');
    setHikeForecast(null);
    setPlannerRecommendation(null);
    setPlannerByTrailId(null);
    setHasOfficialTrails(false);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      // ── Agent 1: Intent ──────────────────────────────────────────
      setAgentStage('intent');
      const rawProfile = await runIntentAgent(query);

      // Override trip type / days from the explicit UI selector
      const isMultiDay = tripMode === 'multi';
      const profile: typeof rawProfile = isMultiDay
        ? (() => {
            const days = tripDays;
            const dailyKm = Math.max(rawProfile.dailyDistanceKm, 12);
            const totalKm = dailyKm * days;
            return {
              ...rawProfile,
              tripType: 'multi_day' as const,
              tripLengthDays: days,
              dailyDistanceKm: dailyKm,
              searchDistanceKm: totalKm,
              maxDistanceKm: Math.max(rawProfile.maxDistanceKm, totalKm),
            };
          })()
        : { ...rawProfile, tripType: 'day_hike' as const, tripLengthDays: 1 };
      console.info('[TrailScout] trip mode override:', { tripMode, tripDays, tripType: profile.tripType, searchDistanceKm: profile.searchDistanceKm });

      setIntentProfile(profile);
      setIntentSummary(profile.reasoning);

      const bbox = profile.bbox;
      const wxLat = (bbox.minLat + bbox.maxLat) / 2;
      const wxLon = (bbox.minLon + bbox.maxLon) / 2;
      const forecast = await fetchForecastForHike(wxLat, wxLon, profile.date);
      setHikeForecast(forecast);

      // ── Fetch trails from OSM (between agents) ──────────────────
      const widenedBBox = widenBBox(bbox, isMultiDay ? 1.4 : 2.25);
      const {
        trails: rawTrails,
        overpassUnavailable,
        hadRawOsmData,
        rawElementCount,
        filteredOutCount,
        partialResults,
      } = await fetchTrailsWithFallback(
        widenedBBox.minLat,
        widenedBBox.minLon,
        widenedBBox.maxLat,
        widenedBBox.maxLon
      );

      // Fetch Colorado-first COTREX, USFS trails, EDW campsites, RIDB facilities, and fire alerts in parallel.
      // COTREX substantially improves Colorado backpacking discovery because it carries statewide
      // CPW/USFS/BLM/local trail inventory with access, manager, surface, dog, elevation, and length fields.
      const [officialTrails, cotrexTrails, edwCampsites, ridbFacilities, alerts] = await Promise.all([
        fetchOfficialTrailsInBBox(
          widenedBBox.minLat, widenedBBox.minLon, widenedBBox.maxLat, widenedBBox.maxLon
        ),
        fetchCotrexTrailsInBBox(
          widenedBBox.minLat, widenedBBox.minLon, widenedBBox.maxLat, widenedBBox.maxLon
        ),
        fetchCampsitesInBBox(
          widenedBBox.minLat, widenedBBox.minLon, widenedBBox.maxLat, widenedBBox.maxLon
        ),
        fetchRidbFacilities(
          widenedBBox.minLat, widenedBBox.minLon, widenedBBox.maxLat, widenedBBox.maxLon
        ),
        fetchForestAlerts(
          widenedBBox.minLat, widenedBBox.minLon, widenedBBox.maxLat, widenedBBox.maxLon
        ),
      ]);
      const authoritativeTrails = [...officialTrails, ...cotrexTrails];
      const mergedSegments = mergeTrailSources(rawTrails, authoritativeTrails);
      const routeCandidates = isMultiDay
        ? buildMultiDayRouteCandidates(mergedSegments, {
            targetKm: profile.searchDistanceKm,
            maxCandidates: 8,
          })
        : [];
      const mergedTrails = isMultiDay ? [...routeCandidates, ...mergedSegments] : mergedSegments;
      setHasOfficialTrails(authoritativeTrails.length > 0);

      // Build fused campsite statuses
      const statuses = buildCampsiteStatuses(edwCampsites, ridbFacilities, alerts, new Date().toISOString());
      setCampsiteStatuses(statuses);
      setForestAlerts(alerts);
      console.info(
        `[TrailScout] official trails: ${officialTrails.length}, COTREX: ${cotrexTrails.length}, merged segments: ${mergedSegments.length}, ` +
        `assembled routes: ${routeCandidates.length}, candidates: ${mergedTrails.length}, ` +
        `campsites: ${edwCampsites.length}, RIDB: ${ridbFacilities.length}, ` +
        `fire alerts: ${alerts.incidents.length} incidents, ${alerts.perimeters.length} perimeters`
      );

      const legacyPrefs = intentToLegacyPrefs(profile);
      const scored = scoreAndFilterTrails(mergedTrails, legacyPrefs).slice(0, isMultiDay ? 10 : 20);

      const withElevation = await enrichTrailsWithElevation(scored, {
        concurrency: isMultiDay ? 4 : 3,
      });

      // Enrich with distance (horizontal)
      const enriched = withElevation.map(t => ({
        ...t,
        distanceKm: effectiveTrailDistanceKm(t),
      }));
      setTrails(enriched);
      console.info('[TrailScout] search pipeline counts', {
        region: profile.estimatedRegionName,
        rawElementCount,
        rawTrails: rawTrails.length,
        scored: scored.length,
        enriched: enriched.length,
        filteredOutCount,
        overpassUnavailable,
        partialResults,
      });

      if (enriched.length === 0) {
        const noUsableTrailData = Boolean(hadRawOsmData) && rawTrails.length === 0;
        setError(
          overpassUnavailable
            ? 'OpenStreetMap trail data is temporarily unavailable (servers busy). Please try again in a minute.'
            : noUsableTrailData
              ? 'OpenStreetMap returned map data here, but TrailScout could not turn it into hike suggestions yet. Try a nearby park, town, or well-known trail region.'
              : rawTrails.length > 0
                ? 'Trail data was found, but none of it survived filtering. Try a broader request or a shorter target distance.'
                : 'No trails found in this area. Try a more specific location like a park, town, or trail region.'
        );
        setAgentStage('idle');
        setScreen('home');
        return;
      }

      // ── Agent 2: Research ────────────────────────────────────────
      setAgentStage('research');
      const researchResults = await runResearchAgent(profile, enriched);
      const trailById = new Map(enriched.map((trail) => [trail.id, trail]));
      const candidatesWithDist = researchResults
        .map((c): TrailCandidate | null => {
          const t = trailById.get(c.trailId);
          if (!t) return null;
          return {
            ...c,
            distanceKm: t.distanceKm ?? calculateDistance(t.path),
          };
        })
        .filter((candidate): candidate is TrailCandidate => candidate != null);
      const finalCandidates = (candidatesWithDist.length > 0
        ? candidatesWithDist
        : fallbackResearchCandidates(enriched)
      ).map((candidate) => {
        const trail = trailById.get(candidate.trailId);
        const deterministicScore = trail
          ? computeDeterministicMatchScore(trail, profile)
          : candidate.matchScore;
        return {
          ...candidate,
          distanceKm: candidate.distanceKm ?? trail?.distanceKm,
          matchScore: deterministicScore,
        };
      });
      setCandidates(finalCandidates);
      setResearchSummary(
        `Found ${finalCandidates.length} strong ${isMultiDay ? 'backpacking' : 'hiking'} candidates in ${profile.estimatedRegionName}${partialResults ? ' using partial OSM data' : ''}. Top research match: ${finalCandidates[0]?.trailName || 'N/A'} (${finalCandidates[0]?.matchScore || 0}%).`
      );

      // ── Agent 3: Validation (deterministic — LLM call removed) ──
      setAgentStage('validation');
      const finalValidations = fallbackValidationResults(finalCandidates, profile);

      const integrated = integratePlanner(profile, forecast, trailById, finalCandidates, finalValidations, query);
      setCandidates(integrated.candidates);
      setValidations(integrated.validations);
      setPlannerRecommendation(integrated.recommendation);
      setPlannerByTrailId(integrated.plannerByTrailId);

      setResearchSummary(
        `Found ${integrated.candidates.length} strong ${isMultiDay ? 'backpacking' : 'hiking'} candidates in ${profile.estimatedRegionName}${partialResults ? ' using partial OSM data' : ''}. After feasibility gates, top ordered: ${integrated.candidates[0]?.trailName || 'N/A'}.`
      );

      const primaryId = integrated.recommendation.primaryTrailId;
      const recommendedCount = integrated.validations.filter((v) => v.isRecommended).length;
      const gateNote =
        integrated.recommendation.status === 'none'
          ? 'No trail passed hard gates — review list for context only.'
          : integrated.recommendation.status === 'conditional'
            ? `Primary pick is conditional (${integrated.recommendation.tripRiskTier} risk tier).`
            : 'Primary pick passed deterministic gates.';
      setValidationSummary(
        `${gateNote} ${recommendedCount ? 1 : 0} primary recommendation. Ordered confidence (top): ${integrated.validations[0]?.confidenceScore ?? 0}%.`
      );

      // ── Build itinerary BEFORE Action Agent so LLM sees deterministic data ──
      setAgentStage('action');
      const topCandidate =
        primaryId != null
          ? integrated.candidates.find((c) => c.trailId === primaryId) ?? integrated.candidates[0]
          : integrated.candidates[0];
      const topValidation =
        integrated.validations.find((v) => v.trailId === topCandidate.trailId) ?? integrated.validations[0];
      const backupCandidate =
        integrated.candidates.find((c) => c.trailId !== topCandidate.trailId) ?? undefined;

      // Build itinerary + effort estimate before LLM call
      let preBuiltItinerary: MultiDayItinerary | null = null;
      let effortEst: EffortEstimate | null = null;
      if (isMultiDay && primaryId != null) {
        const primaryTrail = trailById.get(primaryId);
        if (primaryTrail && primaryTrail.path.length >= 2) {
          preBuiltItinerary = buildMultiDayItinerary(primaryTrail.path, profile.tripLengthDays, primaryTrail, {
            targetDailyKm: profile.dailyDistanceKm,
            campsiteStatuses: statuses,
          });
          effortEst = estimateEffort(primaryTrail, { difficultyHint: profile.difficulty });
          console.info('[TrailScout] multi-day itinerary (pre-action)', preBuiltItinerary);
        }
      } else if (primaryId != null) {
        const primaryTrail = trailById.get(primaryId);
        if (primaryTrail) {
          effortEst = estimateEffort(primaryTrail, { difficultyHint: profile.difficulty });
        }
      }
      setMultiDayItinerary(preBuiltItinerary);
      setEffortEstimate(effortEst);

      // ── Aggregate assumption ledger from all pipeline stages ──
      const ledger: AssumptionEntry[] = [];
      // From planner (safety + feasibility assumptions are in the integrated result)
      const primaryPlanner = primaryId != null ? integrated.plannerByTrailId.get(primaryId) : null;
      if (primaryPlanner) {
        for (const a of primaryPlanner.assumptions) {
          const stage = a.startsWith('[effort]') ? 'effort' as const : 'safety' as const;
          ledger.push({ stage, text: a.replace(/^\[(effort|safety)\]\s*/, ''), severity: 'info' });
        }
        for (const w of primaryPlanner.feasibility.warnings) {
          ledger.push({ stage: 'feasibility', text: w, severity: 'warning' });
        }
        for (const w of primaryPlanner.safety.warnings) {
          ledger.push({ stage: 'safety', text: w, severity: 'warning' });
        }
        for (const a of primaryPlanner.safety.assumptions) {
          ledger.push({ stage: 'safety', text: a, severity: 'info' });
        }
      }
      // From effort estimate
      if (effortEst) {
        for (const a of effortEst.assumptions) {
          const severity = a.includes('No elevation') ? 'warning' as const : 'info' as const;
          ledger.push({ stage: 'effort', text: a.replace(/^\[(effort)\]\s*/, ''), severity });
        }
      }
      // From campsite fusion
      if (statuses.length > 0) {
        const unverifiedCount = statuses.filter(s => s.status === 'unverified').length;
        if (unverifiedCount > 0) {
          ledger.push({ stage: 'campsite', text: `${unverifiedCount} campsite(s) have unverified operational status.`, severity: 'warning' });
        }
        const fireBlocked = statuses.filter(s => s.status === 'fire_blocked').length;
        if (fireBlocked > 0) {
          ledger.push({ stage: 'campsite', text: `${fireBlocked} campsite(s) blocked by active fire perimeters.`, severity: 'critical' });
        }
      }
      // From weather forecast
      if (forecast) {
        if (forecast.precipProbMax != null && forecast.precipProbMax > 50) {
          ledger.push({ stage: 'weather', text: `High precipitation probability (${Math.round(forecast.precipProbMax)}%) — conditions may deteriorate.`, severity: 'warning' });
        }
        if (forecast.tempMinC != null && forecast.tempMinC < 0) {
          ledger.push({ stage: 'weather', text: `Sub-zero temperatures forecast (${forecast.tempMinC}°C) — winter gear needed.`, severity: 'warning' });
        }
      }
      // From itinerary warnings
      if (preBuiltItinerary) {
        for (const w of preBuiltItinerary.warnings) {
          ledger.push({ stage: 'campsite', text: w, severity: 'warning' });
        }
      }
      // Deduplicate by text
      const seenTexts = new Set<string>();
      const dedupedLedger = ledger.filter(a => {
        if (seenTexts.has(a.text)) return false;
        seenTexts.add(a.text);
        return true;
      });
      setAssumptionLedger(dedupedLedger);

      const plannerNoteParts: string[] = [];
      if (integrated.recommendation.tripRiskTier && integrated.recommendation.tripRiskTier !== 'standard') {
        plannerNoteParts.push(`Trip risk tier: ${integrated.recommendation.tripRiskTier}`);
      }
      if (integrated.recommendation.criticalWarnings.length > 0) {
        plannerNoteParts.push(`Warnings: ${integrated.recommendation.criticalWarnings.slice(0, 3).join(' | ')}`);
      }
      if (integrated.recommendation.geometryDisclaimer) {
        plannerNoteParts.push(integrated.recommendation.geometryDisclaimer);
      }

      // Inject effort + itinerary summary so the LLM writes prose consistent with computed data
      if (effortEst) {
        plannerNoteParts.push(
          `Effort estimate: ${effortEst.adjustedTimeHours} h (range ${effortEst.timeRangeHours[0]}–${effortEst.timeRangeHours[1]} h), ` +
          `${effortEst.totalAscentM} m gain, ${effortEst.totalDescentM} m loss, max grade ${effortEst.maxGradePercent}%.`
        );
      }
      if (preBuiltItinerary && preBuiltItinerary.days.length > 1) {
        const itinSummary = preBuiltItinerary.days
          .map(d => `Day ${d.day}: ${d.distanceKm} km${d.effortHours ? ` (~${d.effortHours} h)` : ''} — ${d.campsite ? d.campsite.name : 'no confirmed public-data campsite'}`)
          .join('; ');
        plannerNoteParts.push(`Computed itinerary: ${preBuiltItinerary.totalKm} km over ${preBuiltItinerary.days.length} days. ${itinSummary}.`);
      }

      // ── Agent 4: Action (now receives itinerary context) ──────
      const plan =
        primaryId != null && topCandidate && topValidation
          ? await runActionAgent(
              profile,
              topCandidate,
              topValidation,
              backupCandidate,
              plannerNoteParts.join('\n')
            )
          : buildDeclinedTripPlan(profile, integrated.recommendation);
      setTripPlan(plan);

      // Build travel logistics (airport + ground transport recommendations)
      const trailCenter = {
        lat: (profile.bbox.minLat + profile.bbox.maxLat) / 2,
        lng: (profile.bbox.minLon + profile.bbox.maxLon) / 2,
      };
      const travel = buildTravelPlan(
        approxUserLocation ? { lat: approxUserLocation.lat, lng: approxUserLocation.lng, city: approxUserLocation.city, region: approxUserLocation.region } : null,
        trailCenter.lat,
        trailCenter.lng,
        profile.estimatedRegionName
      );
      setTravelPlan(travel);

      setActionSummary(
        integrated.recommendation.primaryTrailId == null
          ? 'No primary trail selected — review safety notes in the plan view.'
          : plan.tripType === 'multi_day'
            ? `Backpacking plan ready: ${plan.tripLengthDays} days, depart ${plan.departureTime}, finish by ${plan.expectedReturnTime}.`
            : `Trip plan ready: Depart ${plan.departureTime}, return by ${plan.expectedReturnTime}. ${Array.isArray(plan.whatToBring) ? plan.whatToBring.length : 0} items to bring.`
      );

      // ── Complete ─────────────────────────────────────────────────
      setAgentStage('complete');

      // Auto-transition to results after a brief pause
      setTimeout(() => {
        setScreen('results');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 2000);
    } catch (err) {
      console.error('Pipeline error:', err);
      setError('Something went wrong in the planning pipeline. Please try again.');
      setAgentStage('idle');
      setScreen('home');
    }
  };

  // ─── Find matching trail data for a candidate ─────────────────────
  
  const findTrailForCandidate = (candidate: TrailCandidate): TrailData | undefined => {
    return trails.find(t => t.id === candidate.trailId) || trails[0];
  };

  // ─── Rebuild plan + itinerary for a newly selected trail ──────────

  const rebuildPlanForTrail = async (idx: number) => {
    const candidate = candidates[idx];
    if (!candidate || !intentProfile || !plannerRecommendation) return;

    const validation = validations.find(v => v.trailId === candidate.trailId) ?? validations[0];
    const trail = findTrailForCandidate(candidate);
    if (!validation || !trail) return;

    setRebuildingPlan(true);
    try {
      const backupCandidate = candidates.find(c => c.trailId !== candidate.trailId);
      const isMultiDay = intentProfile.tripType === 'multi_day';

      // Build itinerary + effort BEFORE action agent
      let rebuildItinerary: MultiDayItinerary | null = null;
      let rebuildEffort: EffortEstimate | null = null;
      if (isMultiDay && trail.path.length >= 2) {
        rebuildItinerary = buildMultiDayItinerary(trail.path, intentProfile.tripLengthDays, trail, {
          targetDailyKm: intentProfile.dailyDistanceKm,
          campsiteStatuses,
        });
        rebuildEffort = estimateEffort(trail, { difficultyHint: intentProfile.difficulty });
      } else {
        rebuildEffort = estimateEffort(trail, { difficultyHint: intentProfile.difficulty });
      }
      setMultiDayItinerary(rebuildItinerary);
      setEffortEstimate(rebuildEffort);

      const plannerNoteParts: string[] = [];
      if (plannerRecommendation.tripRiskTier && plannerRecommendation.tripRiskTier !== 'standard') {
        plannerNoteParts.push(`Trip risk tier: ${plannerRecommendation.tripRiskTier}`);
      }
      if (plannerRecommendation.criticalWarnings.length > 0) {
        plannerNoteParts.push(`Warnings: ${plannerRecommendation.criticalWarnings.slice(0, 3).join(' | ')}`);
      }
      if (plannerRecommendation.geometryDisclaimer) {
        plannerNoteParts.push(plannerRecommendation.geometryDisclaimer);
      }
      if (rebuildEffort) {
        plannerNoteParts.push(
          `Effort estimate: ${rebuildEffort.adjustedTimeHours} h (range ${rebuildEffort.timeRangeHours[0]}–${rebuildEffort.timeRangeHours[1]} h), ` +
          `${rebuildEffort.totalAscentM} m gain, ${rebuildEffort.totalDescentM} m loss, max grade ${rebuildEffort.maxGradePercent}%.`
        );
      }
      if (rebuildItinerary && rebuildItinerary.days.length > 1) {
        const itinSummary = rebuildItinerary.days
          .map(d => `Day ${d.day}: ${d.distanceKm} km${d.effortHours ? ` (~${d.effortHours} h)` : ''} — ${d.campsite ? d.campsite.name : 'no confirmed public-data campsite'}`)
          .join('; ');
        plannerNoteParts.push(`Computed itinerary: ${rebuildItinerary.totalKm} km over ${rebuildItinerary.days.length} days. ${itinSummary}.`);
      }

      const plan = await runActionAgent(
        intentProfile,
        candidate,
        validation,
        backupCandidate,
        plannerNoteParts.join('\n')
      );
      setTripPlan(plan);

      // Travel plan uses the trail's centroid
      const trailCenter = trail.path.length > 0
        ? trail.path.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 })
        : { lat: (intentProfile.bbox.minLat + intentProfile.bbox.maxLat) / 2, lng: (intentProfile.bbox.minLon + intentProfile.bbox.maxLon) / 2 };
      if (trail.path.length > 0) {
        trailCenter.lat /= trail.path.length;
        trailCenter.lng /= trail.path.length;
      }
      const travel = buildTravelPlan(
        approxUserLocation ? { lat: approxUserLocation.lat, lng: approxUserLocation.lng, city: approxUserLocation.city, region: approxUserLocation.region } : null,
        trailCenter.lat,
        trailCenter.lng,
        intentProfile.estimatedRegionName
      );
      setTravelPlan(travel);
    } catch (err) {
      console.error('[TrailScout] failed to rebuild plan for selected trail', err);
    } finally {
      setRebuildingPlan(false);
    }
  };

  // ─── Reset to home ────────────────────────────────────────────────
  
  const goHome = () => {
    setScreen('home');
    setAgentStage('idle');
    setHikeForecast(null);
    setPlannerRecommendation(null);
    setPlannerByTrailId(null);
    setHasOfficialTrails(false);
    setCampsiteStatuses([]);
    setForestAlerts(null);
    setAssumptionLedger([]);
    setEffortEstimate(null);
  };

  // ═══════════════════════════════════════════════════════════════════
  // ─── RENDER ─────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-navy selection:bg-teal/30 selection:text-offwhite">
      <Navbar onLogoClick={goHome} />

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red/20 border border-red/30 text-red px-6 py-3 rounded-2xl text-sm font-medium backdrop-blur-xl"
          >
            {error}
            <button onClick={() => setError('')} className="ml-4 text-red/60 hover:text-red">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HOME SCREEN                                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {screen === 'home' && (
        <>
          {/* Hero */}
          <section className="relative min-h-screen overflow-x-hidden">
            {/* Background */}
            <div className="absolute inset-0 z-0">
              <img
                src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=2000"
                alt="Mountain landscape"
                className="w-full h-full object-cover opacity-25"
                referrerPolicy="no-referrer"
              />
              <div className="gradient-hero absolute inset-0" />
            </div>

            {/* Subtle grid pattern */}
            <div className="absolute inset-0 z-0" style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(3,212,189,0.03) 1px, transparent 0)',
              backgroundSize: '40px 40px',
            }} />

            <div className="relative z-10 max-w-5xl mx-auto px-6 text-center pt-28 pb-12 md:pb-16">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
              >
                {/* Badge */}
                <div className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full mb-8">
                  <Sparkles className="w-3.5 h-3.5 text-teal" />
                  <span className="text-xs font-semibold text-teal uppercase tracking-wider">
                    Powered by 4 AI Agents
                  </span>
                </div>

                {/* Headline */}
                <h1 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-offwhite leading-[0.95] mb-6">
                  Describe your<br />
                  <span className="text-gradient-warm">perfect hike.</span>
                </h1>

                <p className="text-lg md:text-xl text-offwhite/50 max-w-2xl mx-auto mb-10 leading-relaxed">
                  TrailScout's multi-agent engine interprets your intent, researches real trail data,
                  validates conditions, and delivers an actionable trip plan.
                </p>

                {approxUserLocation && (approxUserLocation.city || approxUserLocation.region) && (
                  <p
                    className="text-[11px] text-offwhite/25 max-w-xl mx-auto mb-6 -mt-6 leading-relaxed cursor-help"
                    title="Approximate area from your network IP. VPNs and shared networks can be wrong. Used only to tune default map center before you search."
                  >
                    Approximate area:{' '}
                    <span className="text-offwhite/40">
                      {[approxUserLocation.city, approxUserLocation.region].filter(Boolean).join(', ')}
                    </span>
                  </p>
                )}

                {/* Search form + live suggestions */}
                <div ref={searchShellRef} className="max-w-2xl mx-auto mb-6 relative z-30">
                  <form onSubmit={handleSearch}>
                    <div className="glass rounded-2xl p-2 shadow-2xl">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="pl-3 sm:pl-4 shrink-0">
                            <MapIcon className="text-offwhite/30 w-5 h-5" />
                          </div>
                          <input
                            type="text"
                            id="hiking-intent-input"
                            value={intent}
                            onChange={(e) => setIntent(e.target.value)}
                            onFocus={() => setExamplesMenuOpen(true)}
                            autoComplete="off"
                            placeholder="e.g. A moderate hike with lake views near Seattle, dog-friendly..."
                            className="min-w-0 flex-1 bg-transparent border-none text-offwhite placeholder:text-offwhite/35 focus:ring-0 focus:outline-none text-base py-3 sm:py-4"
                            aria-autocomplete="list"
                            aria-controls="intent-suggestion-list"
                            aria-expanded={examplesMenuOpen && screen === 'home'}
                          />
                          <button
                            type="button"
                            onClick={() => setExamplesMenuOpen((o) => !o)}
                            className="shrink-0 text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-teal/90 hover:text-teal px-2 py-2 rounded-lg border border-teal/20 bg-teal/5"
                            aria-expanded={examplesMenuOpen}
                            aria-controls="intent-suggestion-list"
                          >
                            Examples
                          </button>
                        </div>

                        {/* Trip mode selector */}
                        <div className="flex items-center gap-2 px-3 sm:px-4 pb-1">
                          <div className="flex rounded-lg overflow-hidden border border-white/10 text-[11px] sm:text-xs font-semibold">
                            <button
                              type="button"
                              onClick={() => setTripMode('day')}
                              className={`px-3 py-1.5 transition-colors ${
                                tripMode === 'day'
                                  ? 'bg-teal/20 text-teal'
                                  : 'text-offwhite/40 hover:text-offwhite/60'
                              }`}
                            >
                              Day Hike
                            </button>
                            <button
                              type="button"
                              onClick={() => setTripMode('multi')}
                              className={`px-3 py-1.5 transition-colors border-l border-white/10 ${
                                tripMode === 'multi'
                                  ? 'bg-teal/20 text-teal'
                                  : 'text-offwhite/40 hover:text-offwhite/60'
                              }`}
                            >
                              Multi-Day
                            </button>
                          </div>

                          {tripMode === 'multi' && (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={tripDays}
                                onChange={(e) => setTripDays(Number(e.target.value))}
                                className="bg-white/5 border border-white/10 rounded-lg text-offwhite text-[11px] sm:text-xs px-2 py-1.5 focus:outline-none focus:border-teal/40 appearance-none cursor-pointer"
                              >
                                {[2, 3, 4, 5, 6, 7].map((d) => (
                                  <option key={d} value={d} className="bg-navy text-offwhite">
                                    {d} days
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <div className="flex-1" />
                          <button
                            type="submit"
                            id="plan-my-hike-btn"
                            disabled={!intent.trim()}
                            className="shrink-0 gradient-orange text-navy px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm hover:shadow-lg hover:shadow-orange/20 transition-all flex items-center gap-2 disabled:opacity-40 whitespace-nowrap"
                          >
                            <span className="sm:hidden inline-flex items-center gap-1">
                              Plan <ArrowRight className="w-4 h-4" />
                            </span>
                            <span className="hidden sm:inline-flex items-center gap-2">
                              Plan My Hike <ArrowRight className="w-4 h-4" />
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>

                  {examplesMenuOpen && screen === 'home' && (
                    <div
                      id="intent-suggestion-list"
                      role="listbox"
                      className="absolute left-0 right-0 top-full mt-2 z-40 rounded-2xl border border-white/15 bg-navy-card shadow-2xl overflow-hidden text-left"
                      style={{backdropFilter: 'blur(12px)'}}
                    >
                      <div className="px-3 py-2 border-b border-white/5 bg-navy-light/80">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-teal">
                          {intent.trim().length < 2 ? 'Example searches' : 'Matching examples'}
                        </span>
                      </div>
                      <ul className="max-h-64 overflow-y-auto py-1 bg-navy-card/98">
                        {intentSuggestions.map((line) => (
                          <li key={line} role="option">
                            <button
                              type="button"
                              className="w-full text-left px-4 py-2.5 text-sm text-offwhite/90 hover:bg-white/10 hover:text-offwhite transition-colors"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setIntent(line);
                                setExamplesMenuOpen(false);
                              }}
                            >
                              {line}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

              </motion.div>
            </div>
          </section>

          {/* How it works */}
          <section id="how-it-works" className="py-16 md:py-20 border-t border-white/5">
            <div className="max-w-7xl mx-auto px-6">
              <div className="text-center mb-16">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-offwhite mb-4">
                  Four agents. <span className="text-gradient-teal">One perfect plan.</span>
                </h2>
                <p className="text-offwhite/40 text-lg max-w-xl mx-auto">
                  TrailScout isn't a chatbot — it's a multi-agent system where specialized AI agents collaborate behind the scenes.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
                {[
                  {
                    icon: Brain,
                    name: 'Intent Agent',
                    desc: 'Turns your request into location, distance, difficulty, and key preferences.',
                    color: '#A78BFA',
                    num: '01',
                  },
                  {
                    icon: Search,
                    name: 'Research Agent',
                    desc: 'Finds real trails and adds weather, drive time, and scenery context.',
                    color: '#60A5FA',
                    num: '02',
                  },
                  {
                    icon: ShieldCheck,
                    name: 'Validation Agent',
                    desc: 'Checks fit, highlights risks, and scores confidence for each option.',
                    color: '#03D4BD',
                    num: '03',
                  },
                  {
                    icon: Zap,
                    name: 'Action Agent',
                    desc: 'Builds a ready-to-go plan with timing, gear, safety notes, and backups.',
                    color: '#FF7D0F',
                    num: '04',
                  },
                ].map(({ icon: Icon, name, desc, color, num }) => (
                  <motion.div
                    key={name}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="glass-bright rounded-xl p-3 sm:p-4 lg:p-5 group hover:scale-[1.02] transition-transform"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 mb-3">
                      <div
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <Icon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color }} />
                      </div>
                      <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider" style={{ color: `${color}80` }}>
                        Agent {num}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-xs sm:text-sm lg:text-base text-offwhite mb-2 leading-tight">{name}</h3>
                    <p className="text-[10px] sm:text-xs text-offwhite/40 leading-snug">{desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="py-12 border-t border-white/5">
            <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <Compass className="text-teal w-5 h-5" />
                <span className="font-display font-bold text-offwhite">TrailScout</span>
              </div>
              <p className="text-offwhite/20 text-[10px] uppercase tracking-widest">
                Data: OpenStreetMap · AI: Google Gemini · Multi-Agent Architecture
              </p>
            </div>
          </footer>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* WORKFLOW SCREEN                                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {screen === 'workflow' && (
        <section className="min-h-screen pt-28 pb-20 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto">
            {/* User query display */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-bright rounded-2xl p-5 mb-8 flex items-start gap-4"
            >
              <div className="bg-orange/20 p-2 rounded-xl flex-shrink-0">
                <MapIcon className="w-5 h-5 text-orange" />
              </div>
              <div>
                <div className="text-[10px] text-offwhite/30 uppercase tracking-wider mb-1">Your Request</div>
                <p className="text-sm text-offwhite/80 leading-relaxed">{intent}</p>
              </div>
            </motion.div>

            {/* Agent workflow visualization */}
            <AgentWorkflow
              currentStage={agentStage}
              intentSummary={intentSummary}
              researchSummary={researchSummary}
              validationSummary={validationSummary}
              actionSummary={actionSummary}
            />
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* RESULTS SCREEN                                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {screen === 'results' && (
        <section className="min-h-screen pt-24 pb-20 px-6" ref={resultsRef}>
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                <div className="inline-flex items-center gap-2 bg-green/10 border border-green/20 px-4 py-2 rounded-full">
                  <ShieldCheck className="w-3.5 h-3.5 text-green" />
                  <span className="text-xs font-semibold text-green uppercase tracking-wider">
                    {candidates.length} Trails Analyzed & Validated
                  </span>
                </div>
                {hasOfficialTrails && (
                  <div className="inline-flex items-center gap-2 bg-amber/10 border border-amber/25 px-4 py-2 rounded-full">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber" />
                    <span className="text-xs font-semibold text-amber uppercase tracking-wider">
                      Includes USFS Verified Trails
                    </span>
                  </div>
                )}
              </div>
              <h2 className="font-display text-4xl md:text-5xl font-bold text-offwhite mb-3">
                Your Top Matches
              </h2>
              <p className="text-offwhite/40 max-w-lg mx-auto">
                {intentProfile?.estimatedRegionName && (
                  <span className="text-teal font-medium">{intentProfile.estimatedRegionName}</span>
                )}{' '}
                — ordered after deterministic feasibility and safety gates; AI match scores are secondary.
              </p>
              {intentProfile && intentProfile.maxDistanceKm > 0 && (
                <p className="text-offwhite/35 text-sm mt-3 max-w-xl mx-auto">
                  Your target {intentProfile.tripType === 'multi_day' ? 'trip length' : 'hike length'}:{' '}
                  <span className="text-offwhite/60 font-semibold tabular-nums">
                    ~{intentProfile.maxDistanceKm.toFixed(1)} km
                  </span>{' '}
                  <span className="text-offwhite/30">
                    (~{(intentProfile.maxDistanceKm * 0.621371).toFixed(1)} mi)
                  </span>
                  {intentProfile.tripType === 'multi_day' && (
                    <>
                      {' '}across{' '}
                      <span className="text-offwhite/50">{intentProfile.tripLengthDays} days</span>
                      {' '}with a route-discovery target near{' '}
                      <span className="text-offwhite/60 font-semibold tabular-nums">
                        {intentProfile.searchDistanceKm.toFixed(1)} km
                      </span>.
                    </>
                  )}
                  {' '}Trail lengths below are{' '}
                  <span className="text-offwhite/50">{hasOfficialTrails ? 'mapped USFS/OSM geometry' : 'mapped OSM geometry'}</span> (route or segment), not always a full loop.
                </p>
              )}
            </motion.div>

            {plannerRecommendation && plannerRecommendation.status === 'none' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 max-w-2xl mx-auto rounded-2xl border border-red/30 bg-red/10 px-4 py-3 text-left"
              >
                <div className="text-[10px] font-bold text-red uppercase tracking-wider mb-1">No primary recommendation</div>
                <p className="text-sm text-offwhite/85 leading-snug">
                  No trail passed deterministic distance, timing, weather, and safety gates. Match scores are for context only — verify everything locally.
                </p>
                {plannerRecommendation.blockingReasons.length > 0 && (
                  <ul className="mt-2 text-xs text-offwhite/65 list-disc pl-4 space-y-1">
                    {plannerRecommendation.blockingReasons.slice(0, 5).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}

            {plannerRecommendation && plannerRecommendation.status === 'conditional' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 max-w-2xl mx-auto rounded-2xl border border-amber/35 bg-amber/10 px-4 py-3 text-left"
              >
                <div className="text-[10px] font-bold text-amber uppercase tracking-wider mb-1">Conditional primary pick</div>
                <p className="text-sm text-offwhite/85 leading-snug">
                  The ordered trail passes gates but is flagged as higher risk ({plannerRecommendation.tripRiskTier}). Read warnings carefully and turn back if conditions disagree.
                </p>
                {plannerRecommendation.criticalWarnings.length > 0 && (
                  <ul className="mt-2 text-xs text-offwhite/65 list-disc pl-4 space-y-1">
                    {plannerRecommendation.criticalWarnings.slice(0, 4).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}

            {plannerRecommendation?.assumptions && plannerRecommendation.assumptions.length > 0 && plannerRecommendation.status === 'recommended' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left"
              >
                <div className="text-[10px] font-bold text-offwhite/50 uppercase tracking-wider mb-1">Assumptions</div>
                <ul className="text-xs text-offwhite/65 list-disc pl-4 space-y-1">
                  {plannerRecommendation.assumptions.slice(0, 4).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </motion.div>
            )}

            {hikeForecast && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex justify-center px-2"
              >
                <div className="inline-flex items-start gap-3 glass-bright border border-blue/20 rounded-2xl px-4 py-3 max-w-2xl text-left">
                  <CloudRain className="w-5 h-5 text-blue shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-bold text-blue uppercase tracking-wider mb-1">
                      Forecast (Open-Meteo)
                    </div>
                    <p className="text-sm text-offwhite/80 leading-snug">
                      {intentProfile?.estimatedRegionName && (
                        <span className="text-teal font-medium">{intentProfile.estimatedRegionName}</span>
                      )}
                      {intentProfile?.estimatedRegionName ? ' · ' : ''}
                      <span className="text-offwhite/50">{hikeForecast.matchedDate}</span>
                      {' — '}
                      {hikeForecast.summary}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Map */}
            {trails.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="h-[350px] w-full mb-10"
              >
                <MapContainer
                  trails={trails.slice(0, 5).map((t, i) => ({
                    ...t,
                    tags: { ...t.tags, color: i === selectedTrailIndex ? '#FF7D0F' : '#03D4BD' }
                  }))}
                  focusedTrailId={trails[selectedTrailIndex]?.id || null}
                  center={
                    approxUserLocation
                      ? { lat: approxUserLocation.lat, lng: approxUserLocation.lng }
                      : undefined
                  }
                  poiMarkers={campsiteStatuses.map(cs => ({
                    lat: cs.campsite.lat,
                    lng: cs.campsite.lng,
                    name: cs.campsite.name,
                    type: cs.campsite.siteType === 'trailhead' ? 'trailhead' as const : 'campsite' as const,
                    status: cs.status,
                  }))}
                />
              </motion.div>
            )}

            {/* Results — baseball-card tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6 mb-12 items-stretch justify-items-center">
              {candidates.slice(0, 5).map((candidate, idx) => {
                const trail = findTrailForCandidate(candidate);
                const validation = validations.find(v => v.trailId === candidate.trailId);
                if (!trail) return null;

                return (
                  <TrailResultCard
                    key={candidate.trailId}
                    trail={trail}
                    candidate={candidate}
                    validation={validation}
                    planner={plannerByTrailId?.get(candidate.trailId)}
                    rank={idx}
                    isSelected={selectedTrailIndex === idx}
                    targetMaxKm={intentProfile?.maxDistanceKm}
                    onSelect={() => {
                      if (idx !== selectedTrailIndex) {
                        setSelectedTrailIndex(idx);
                        rebuildPlanForTrail(idx);
                      }
                    }}
                  />
                );
              })}
            </div>

            {/* View trip plan CTA */}
            {tripPlan && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-center"
              >
                <button
                  disabled={rebuildingPlan}
                  onClick={() => {
                    if (!rebuildingPlan) {
                      setScreen('plan');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`gradient-orange text-navy px-8 py-4 rounded-2xl font-bold text-lg transition-all inline-flex items-center gap-3 glow-orange ${rebuildingPlan ? 'opacity-60 cursor-wait' : 'hover:shadow-lg hover:shadow-orange/20'}`}
                >
                  {rebuildingPlan ? (
                    <>
                      <Sparkles className="w-5 h-5 animate-spin" />
                      Rebuilding Plan…
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      {tripPlan.tripType === 'multi_day' ? 'View Full Backpacking Plan' : 'View Full Trip Plan'}
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
                <p className="text-offwhite/20 text-xs mt-3">
                  {rebuildingPlan
                    ? 'Updating plan for the selected trail…'
                    : tripPlan.tripType === 'multi_day'
                      ? 'Includes day-by-day itinerary, backpacking checklist, logistics, and backup option'
                      : 'Includes departure time, packing list, calendar event, and backup option'}
                </p>
              </motion.div>
            )}

            {/* New search */}
            <div className="text-center mt-12">
              <button
                onClick={goHome}
                className="text-sm text-offwhite/30 hover:text-teal transition-colors"
              >
                ← Start a new search
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TRIP PLAN SCREEN                                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {screen === 'plan' && tripPlan && candidates.length > 0 && (
        <section className="min-h-screen pt-24 pb-20 px-6">
          <div className="max-w-5xl mx-auto">
            {(() => {
              const candidate = candidates[selectedTrailIndex] || candidates[0];
              const trail = findTrailForCandidate(candidate);
              const validation = validations.find(v => v.trailId === candidate.trailId) || validations[0];

              if (!trail || !validation) return null;

              return (
                <TripPlanView
                  plan={tripPlan}
                  trail={trail}
                  candidate={candidate}
                  validation={validation}
                  trailIndex={selectedTrailIndex}
                  intentProfile={intentProfile ?? undefined}
                  targetHikeKm={intentProfile?.maxDistanceKm}
                  plannerRecommendation={plannerRecommendation ?? undefined}
                  multiDayItinerary={multiDayItinerary ?? undefined}
                  travelPlan={travelPlan ?? undefined}
                  campsiteStatuses={campsiteStatuses}
                  forestAlerts={forestAlerts ?? undefined}
                  assumptions={assumptionLedger}
                  effortEstimate={effortEstimate ?? undefined}
                  onBack={() => {
                    setScreen('results');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              );
            })()}
          </div>
        </section>
      )}
    </div>
  );
}
