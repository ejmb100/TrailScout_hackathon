/**
 * TrailScout — Multi-Agent Outdoor Planning Engine
 * 
 * Architecture:
 *   Agent 1: Intent Agent (parses NL → structured profile)
 *   Agent 2: Research Agent (enriches trails with context)
 *   Agent 3: Validation Agent (validates against constraints)
 *   Agent 4: Action Agent (generates trip plan)
 */

import React, { useState, useRef } from 'react';
import {
  Compass,
  Map as MapIcon,
  ArrowRight,
  Menu,
  X,
  Mountain,
  Wind,
  Dog,
  Baby,
  Gauge,
  Ruler,
  Brain,
  Search,
  ShieldCheck,
  Zap,
  ChevronDown,
  Sparkles,
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
  runValidationAgent,
  runActionAgent,
  intentToLegacyPrefs,
  type IntentProfile,
  type TrailCandidate,
  type ValidationResult,
  type TripPlan,
} from './services/geminiService';
import { fetchTrailsInBBox, type TrailData } from './services/osmService';
import { scoreAndFilterTrails, calculateDistance } from './utils/trailScoring';

// ─── Screen types ─────────────────────────────────────────────────────

type AppScreen = 'home' | 'workflow' | 'results' | 'plan';

// ─── Prompt chips ─────────────────────────────────────────────────────

const promptChips = [
  "I'm visiting Seattle tomorrow and want a moderate hike with lake views, under 7 miles, dog-friendly, back by 2pm",
  "A challenging ridge walk in the Swiss Alps with stunning panoramic views, 15+ km",
  "Easy family hike near Portland with waterfalls, kid-friendly, under 4 miles",
  "I want a quiet forest trail near Asheville NC, no crowds, moderate difficulty",
  "Weekend day hike near Denver with wildflowers and mountain views, 8-10 miles",
];

// ─── Quick filter options ─────────────────────────────────────────────

interface QuickFilters {
  difficulty: string;
  dogFriendly: boolean;
  kidFriendly: boolean;
  maxDistance: string;
}

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
          <a href="#features" className="text-sm text-offwhite/50 hover:text-teal transition-colors">Features</a>
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
              <a href="#features" className="block text-offwhite/60 py-2" onClick={() => setIsOpen(false)}>Features</a>
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
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({
    difficulty: '',
    dogFriendly: false,
    kidFriendly: false,
    maxDistance: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Agent pipeline state
  const [agentStage, setAgentStage] = useState<AgentStage>('idle');
  const [intentProfile, setIntentProfile] = useState<IntentProfile | null>(null);
  const [trails, setTrails] = useState<TrailData[]>([]);
  const [candidates, setCandidates] = useState<TrailCandidate[]>([]);
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [tripPlan, setTripPlan] = useState<TripPlan | null>(null);
  const [selectedTrailIndex, setSelectedTrailIndex] = useState(0);

  // Agent summaries for the workflow display
  const [intentSummary, setIntentSummary] = useState('');
  const [researchSummary, setResearchSummary] = useState('');
  const [validationSummary, setValidationSummary] = useState('');
  const [actionSummary, setActionSummary] = useState('');

  // Error state
  const [error, setError] = useState('');

  const resultsRef = useRef<HTMLDivElement>(null);

  // ─── Build query with filters ─────────────────────────────────────
  
  const buildQuery = (): string => {
    let query = intent.trim();
    const additions: string[] = [];
    if (quickFilters.difficulty) additions.push(`${quickFilters.difficulty} difficulty`);
    if (quickFilters.dogFriendly) additions.push('dog-friendly');
    if (quickFilters.kidFriendly) additions.push('kid-friendly');
    if (quickFilters.maxDistance) additions.push(`max ${quickFilters.maxDistance}`);
    if (additions.length > 0) {
      query += `. Additional preferences: ${additions.join(', ')}.`;
    }
    return query;
  };

  // ─── Run the multi-agent pipeline ─────────────────────────────────
  
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = buildQuery();
    if (!query) return;

    setError('');
    setScreen('workflow');
    setAgentStage('idle');
    setCandidates([]);
    setValidations([]);
    setTripPlan(null);
    setSelectedTrailIndex(0);
    setIntentSummary('');
    setResearchSummary('');
    setValidationSummary('');
    setActionSummary('');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      // ── Agent 1: Intent ──────────────────────────────────────────
      setAgentStage('intent');
      const profile = await runIntentAgent(query);
      setIntentProfile(profile);
      setIntentSummary(profile.reasoning);

      // ── Fetch trails from OSM (between agents) ──────────────────
      const bbox = profile.bbox;
      const rawTrails = await fetchTrailsInBBox(bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon);
      const legacyPrefs = intentToLegacyPrefs(profile);
      const scored = scoreAndFilterTrails(rawTrails, legacyPrefs).slice(0, 20);
      
      // Enrich with distance
      const enriched = scored.map(t => ({
        ...t,
        distanceKm: calculateDistance(t.path),
      }));
      setTrails(enriched);

      if (enriched.length === 0) {
        setError('No trails found in this area. Try a different location or wider search.');
        setAgentStage('idle');
        setScreen('home');
        return;
      }

      // ── Agent 2: Research ────────────────────────────────────────
      setAgentStage('research');
      const researchResults = await runResearchAgent(profile, enriched);
      setCandidates(researchResults);
      setResearchSummary(`Found ${researchResults.length} strong candidates in ${profile.estimatedRegionName}. Top match: ${researchResults[0]?.trailName || 'N/A'} (${researchResults[0]?.matchScore || 0}%).`);

      // ── Agent 3: Validation ──────────────────────────────────────
      setAgentStage('validation');
      const validationResults = await runValidationAgent(profile, researchResults);
      setValidations(validationResults);
      const recommended = validationResults.filter(v => v.isRecommended).length;
      const topFit = validationResults[0]?.overallFit || 'unknown';
      setValidationSummary(`${recommended} trails passed validation. Top trail rated "${topFit}" with ${validationResults[0]?.confidenceScore || 0}% confidence.`);

      // ── Agent 4: Action ──────────────────────────────────────────
      setAgentStage('action');
      const topCandidate = researchResults[0];
      const topValidation = validationResults[0];
      const backupCandidate = researchResults.length > 1 ? researchResults[1] : undefined;
      
      const plan = await runActionAgent(profile, topCandidate, topValidation, backupCandidate);
      setTripPlan(plan);
      setActionSummary(`Trip plan ready: Depart ${plan.departureTime}, return by ${plan.expectedReturnTime}. ${plan.whatToBring.length} items to bring.`);

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

  // ─── Reset to home ────────────────────────────────────────────────
  
  const goHome = () => {
    setScreen('home');
    setAgentStage('idle');
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
          <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
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

            <div className="relative z-10 max-w-5xl mx-auto px-6 text-center pt-24 pb-16">
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

                {/* Search form */}
                <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-6">
                  <div className="glass rounded-2xl p-2 shadow-2xl">
                    <div className="flex items-center gap-3">
                      <div className="pl-4">
                        <MapIcon className="text-offwhite/30 w-5 h-5" />
                      </div>
                      <input
                        type="text"
                        id="hiking-intent-input"
                        value={intent}
                        onChange={(e) => setIntent(e.target.value)}
                        placeholder="e.g. A moderate hike with lake views near Seattle, dog-friendly..."
                        className="flex-1 bg-transparent border-none text-offwhite placeholder:text-offwhite/25 focus:ring-0 focus:outline-none text-base py-4"
                      />
                      <button
                        type="submit"
                        id="plan-my-hike-btn"
                        disabled={!intent.trim() && agentStage !== 'idle'}
                        className="gradient-orange text-navy px-6 py-3.5 rounded-xl font-bold text-sm hover:shadow-lg hover:shadow-orange/20 transition-all flex items-center gap-2 disabled:opacity-40 whitespace-nowrap"
                      >
                        Plan My Hike <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </form>

                {/* Quick filters toggle */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="text-xs text-offwhite/30 hover:text-offwhite/60 transition-colors flex items-center gap-1 mx-auto mb-4"
                >
                  Quick preferences <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                {/* Quick filters */}
                <AnimatePresence>
                  {showFilters && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="max-w-2xl mx-auto mb-8"
                    >
                      <div className="glass rounded-2xl p-4 flex flex-wrap gap-3 justify-center">
                        {/* Difficulty */}
                        <select
                          value={quickFilters.difficulty}
                          onChange={(e) => setQuickFilters(f => ({ ...f, difficulty: e.target.value }))}
                          className="bg-white/5 border border-white/10 text-offwhite/70 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal"
                        >
                          <option value="">Difficulty</option>
                          <option value="easy">Easy</option>
                          <option value="moderate">Moderate</option>
                          <option value="hard">Hard</option>
                          <option value="expert">Expert</option>
                        </select>

                        {/* Max distance */}
                        <select
                          value={quickFilters.maxDistance}
                          onChange={(e) => setQuickFilters(f => ({ ...f, maxDistance: e.target.value }))}
                          className="bg-white/5 border border-white/10 text-offwhite/70 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal"
                        >
                          <option value="">Max Distance</option>
                          <option value="3 miles">3 miles</option>
                          <option value="5 miles">5 miles</option>
                          <option value="7 miles">7 miles</option>
                          <option value="10 miles">10 miles</option>
                          <option value="15 miles">15 miles</option>
                        </select>

                        {/* Dog friendly */}
                        <button
                          onClick={() => setQuickFilters(f => ({ ...f, dogFriendly: !f.dogFriendly }))}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                            quickFilters.dogFriendly
                              ? 'bg-teal/20 border-teal/30 text-teal'
                              : 'bg-white/5 border-white/10 text-offwhite/50'
                          }`}
                        >
                          <Dog className="w-3.5 h-3.5" /> Dog-friendly
                        </button>

                        {/* Kid friendly */}
                        <button
                          onClick={() => setQuickFilters(f => ({ ...f, kidFriendly: !f.kidFriendly }))}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                            quickFilters.kidFriendly
                              ? 'bg-teal/20 border-teal/30 text-teal'
                              : 'bg-white/5 border-white/10 text-offwhite/50'
                          }`}
                        >
                          <Baby className="w-3.5 h-3.5" /> Kid-friendly
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Prompt chips */}
                <div className="max-w-3xl mx-auto">
                  <p className="text-[10px] text-offwhite/20 uppercase tracking-widest mb-3">Try an example</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {promptChips.map((chip, i) => (
                      <button
                        key={i}
                        onClick={() => setIntent(chip)}
                        className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-teal/20 text-offwhite/40 hover:text-offwhite/70 px-3 py-1.5 rounded-full text-[11px] transition-all text-left max-w-xs truncate"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          </section>

          {/* How it works */}
          <section id="how-it-works" className="py-24 border-t border-white/5">
            <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-16">
                <h2 className="font-display text-4xl md:text-5xl font-bold text-offwhite mb-4">
                  Four agents. <span className="text-gradient-teal">One perfect plan.</span>
                </h2>
                <p className="text-offwhite/40 text-lg max-w-xl mx-auto">
                  TrailScout isn't a chatbot — it's a multi-agent system where specialized AI agents collaborate behind the scenes.
                </p>
              </div>

              <div className="grid md:grid-cols-4 gap-6">
                {[
                  {
                    icon: Brain,
                    name: 'Intent Agent',
                    desc: 'Parses your natural language into structured preferences — location, difficulty, constraints, and hidden intent.',
                    color: '#A78BFA',
                    num: '01',
                  },
                  {
                    icon: Search,
                    name: 'Research Agent',
                    desc: 'Searches real trail databases, enriches with weather data, drive times, crowd estimates, and scenery analysis.',
                    color: '#60A5FA',
                    num: '02',
                  },
                  {
                    icon: ShieldCheck,
                    name: 'Validation Agent',
                    desc: 'Checks every trail against your constraints. Flags risks, tradeoffs, and missing data with confidence scores.',
                    color: '#03D4BD',
                    num: '03',
                  },
                  {
                    icon: Zap,
                    name: 'Action Agent',
                    desc: 'Builds your trip plan with departure time, packing list, safety notes, backup options, and calendar events.',
                    color: '#FF7D0F',
                    num: '04',
                  },
                ].map(({ icon: Icon, name, desc, color, num }) => (
                  <motion.div
                    key={name}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="glass-bright rounded-2xl p-6 group hover:scale-[1.02] transition-transform"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <Icon className="w-5 h-5" style={{ color }} />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${color}80` }}>
                        Agent {num}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-lg text-offwhite mb-2">{name}</h3>
                    <p className="text-sm text-offwhite/40 leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="py-24 border-t border-white/5">
            <div className="max-w-6xl mx-auto px-6">
              <div className="grid md:grid-cols-3 gap-6">
                {[
                  {
                    title: 'Intent-Based Planning',
                    desc: "Describe how you want to feel — adventurous, peaceful, challenged — and we'll find the trail that matches.",
                    icon: <Wind className="w-6 h-6 text-orange" />,
                  },
                  {
                    title: 'Data-Grounded Results',
                    desc: 'Every recommendation is backed by real OpenStreetMap trail data, not generic suggestions.',
                    icon: <Mountain className="w-6 h-6 text-teal" />,
                  },
                  {
                    title: 'Actionable Trip Plans',
                    desc: 'Get departure times, packing lists, calendar events, and backup options — ready to go.',
                    icon: <Compass className="w-6 h-6 text-purple" />,
                  },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="glass-bright p-8 rounded-2xl group hover:scale-[1.02] transition-transform"
                  >
                    <div className="mb-6 bg-white/5 p-3.5 rounded-xl inline-block border border-white/5 group-hover:border-teal/20 transition-colors">
                      {item.icon}
                    </div>
                    <h3 className="font-display text-xl font-bold text-offwhite mb-3">{item.title}</h3>
                    <p className="text-offwhite/40 leading-relaxed text-sm">{item.desc}</p>
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
        <section className="min-h-screen pt-28 pb-20 px-6">
          <div className="max-w-4xl mx-auto">
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
              <div className="inline-flex items-center gap-2 bg-green/10 border border-green/20 px-4 py-2 rounded-full mb-4">
                <ShieldCheck className="w-3.5 h-3.5 text-green" />
                <span className="text-xs font-semibold text-green uppercase tracking-wider">
                  {candidates.length} Trails Analyzed & Validated
                </span>
              </div>
              <h2 className="font-display text-4xl md:text-5xl font-bold text-offwhite mb-3">
                Your Top Matches
              </h2>
              <p className="text-offwhite/40 max-w-lg mx-auto">
                {intentProfile?.estimatedRegionName && (
                  <span className="text-teal font-medium">{intentProfile.estimatedRegionName}</span>
                )}{' '}
                — ranked by fit, validated against your constraints.
              </p>
            </motion.div>

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
                />
              </motion.div>
            )}

            {/* Results grid */}
            <div className="grid md:grid-cols-3 gap-6 mb-12">
              {candidates.slice(0, 3).map((candidate, idx) => {
                const trail = findTrailForCandidate(candidate);
                const validation = validations.find(v => v.trailId === candidate.trailId);
                if (!trail) return null;

                return (
                  <TrailResultCard
                    key={candidate.trailId}
                    trail={trail}
                    candidate={candidate}
                    validation={validation}
                    rank={idx}
                    isSelected={selectedTrailIndex === idx}
                    onSelect={() => {
                      setSelectedTrailIndex(idx);
                      // Show the plan for the selected trail
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
                  onClick={() => {
                    setScreen('plan');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="gradient-orange text-navy px-8 py-4 rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-orange/20 transition-all inline-flex items-center gap-3 glow-orange"
                >
                  <Zap className="w-5 h-5" />
                  View Full Trip Plan
                  <ArrowRight className="w-5 h-5" />
                </button>
                <p className="text-offwhite/20 text-xs mt-3">
                  Includes departure time, packing list, calendar event, and backup option
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
