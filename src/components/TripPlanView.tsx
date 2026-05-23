import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin,
  Clock,
  Sun,
  CloudRain,
  Shield,
  Backpack,
  CalendarPlus,
  Share2,
  Bookmark,
  Download,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Compass,
  ArrowLeft,
  Star,
  Navigation,
  Package,
  TrendingUp,
  TrendingDown,
  Tent,
  Plane,
  Car,
  Gauge,
} from 'lucide-react';
import type { IntentProfile, TripPlan, TrailCandidate, ValidationResult } from '../services/geminiService';
import type { PlannerRecommendation, MultiDayItinerary, AssumptionEntry, EffortEstimate } from '../planner';
import { buildTrainingProgram, trainingProgramToMarkdown, effortDifficultyTier, effortTierColor } from '../planner';
import { buildDaySegmentLabel, getCampNightCoverage } from './itineraryDisplay';
import type { TravelPlan } from '../services/travelLogisticsService';
import type { TrailData } from '../services/osmService';
import type { CampsiteStatus } from '../services/campsiteStatusService';
import type { ForestAlerts } from '../services/forestAlertService';
import { statusLabel, statusColor } from '../services/campsiteStatusService';
import { calculateDistance } from '../utils/trailScoring';
import { getDataVintage } from '../services/officialTrailService';
import MapContainer from './MapContainer';
import { type MapMarkerData } from './MapContainer';
import { buildTripPoiMarkers } from './tripPoiMarkers';

// Same curated images as ResultCard
const trailImages = [
  'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&q=80&w=1200&h=600',
  'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&q=80&w=1200&h=600',
  'https://images.unsplash.com/photo-1533240332313-0db49b459ad6?auto=format&fit=crop&q=80&w=1200&h=600',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&q=80&w=1200&h=600',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=1200&h=600',
];

interface TripPlanViewProps {
  plan: TripPlan;
  trail: TrailData;
  candidate: TrailCandidate;
  validation: ValidationResult;
  trailIndex: number;
  intentProfile?: IntentProfile;
  /** User's desired hike length from intent (km), for comparison to mapped geometry. */
  targetHikeKm?: number;
  plannerRecommendation?: PlannerRecommendation;
  multiDayItinerary?: MultiDayItinerary;
  travelPlan?: TravelPlan;
  campsiteStatuses?: CampsiteStatus[];
  forestAlerts?: ForestAlerts;
  assumptions?: AssumptionEntry[];
  effortEstimate?: EffortEstimate;
  onBack: () => void;
}

const TripPlanView: React.FC<TripPlanViewProps> = ({
  plan,
  trail,
  candidate,
  validation,
  trailIndex,
  intentProfile,
  targetHikeKm,
  plannerRecommendation,
  multiDayItinerary,
  travelPlan,
  campsiteStatuses,
  forestAlerts,
  assumptions = [],
  effortEstimate,
  onBack,
}) => {
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  const distKm = calculateDistance(trail.path);
  const imageUrl = trailImages[trailIndex % trailImages.length];
  const checklistItems = Array.isArray(plan.packingChecklist) ? plan.packingChecklist : [];
  const dailyPlan = Array.isArray(plan.dailyPlan) ? plan.dailyPlan : [];
  const logisticsNotes = Array.isArray(plan.logisticsNotes) ? plan.logisticsNotes : [];
  const isMultiDay = plan.tripType === 'multi_day' || intentProfile?.tripType === 'multi_day';
  const tripLengthDays = Math.max(plan.tripLengthDays || intentProfile?.tripLengthDays || 1, 1);

  const effortTier = effortEstimate ? effortDifficultyTier(effortEstimate, distKm) : null;
  const effortColor = effortTier ? effortTierColor(effortTier) : 'text-offwhite/50';
  const trainingProgram = effortEstimate
    ? buildTrainingProgram({
        effort: effortEstimate,
        distanceKm: targetHikeKm && targetHikeKm > distKm ? targetHikeKm : distKm,
        tripDays: tripLengthDays,
        weeksUntilTrip: 8,
        conditions: {
          dateText: intentProfile?.date,
          regionText: `${intentProfile?.estimatedRegionName ?? ''} ${intentProfile?.location ?? ''}`,
          conditionText: `${plan.conditionsSummary} ${plan.weatherSummary} ${Array.isArray(plan.safetyNotes) ? plan.safetyNotes.join(' ') : plan.safetyNotes}`,
        },
      })
    : null;

  const poiMarkers: MapMarkerData[] = buildTripPoiMarkers(multiDayItinerary, campsiteStatuses);
  const campNightCoverage = getCampNightCoverage(multiDayItinerary, tripLengthDays);

  const nearestAirport = travelPlan?.nearestAirports[0];
  const trailheadArrivalLabel = nearestAirport
    ? `Nearest airport: ${nearestAirport.airport.code} (${nearestAirport.airport.city}), ~${nearestAirport.distToTrailheadKm} km from the trailhead.`
    : 'Arrive at trailhead — check travel logistics below for airport and transport info.';
  const bringItems = checklistItems.length > 0
    ? checklistItems.slice(0, 6)
    : Array.isArray(plan.whatToBring)
      ? plan.whatToBring
      : [];

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  // Generate .ics calendar event
  const handleAddCalendar = () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0);
    const endDate = new Date(startDate.getTime() + 5 * 60 * 60 * 1000);
    if (isMultiDay) {
      endDate.setDate(startDate.getDate() + tripLengthDays - 1);
      endDate.setHours(18, 0, 0, 0);
    }
    
    const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${plan.calendarTitle}
DESCRIPTION:${plan.calendarDescription.replace(/\n/g, '\\n')}
LOCATION:${trail.name}
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    triggerDownload(blob, `trailscout_${trail.name?.replace(/\s+/g, '_') || 'hike'}.ics`);
    setCalendarAdded(true);
  };

  // Share plan
  const handleShare = async () => {
    const text = plan.shareableSummary;
    if (navigator.share) {
      try {
        await navigator.share({ title: plan.calendarTitle, text });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
    }
    setShared(true);
  };

  const handleDownloadTrainingProgram = () => {
    if (!trainingProgram) return;
    const md = trainingProgramToMarkdown(trainingProgram, {
      tripName: plan.recommendedTrailName || trail.name || 'TrailScout hike',
      totalDistanceKm: targetHikeKm && targetHikeKm > distKm ? targetHikeKm : distKm,
      tripDays: tripLengthDays,
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    triggerDownload(blob, `trailscout_training_${trail.name?.replace(/\s+/g, '_') || 'program'}.md`);
  };

  // Download full plan
  const handleDownload = () => {
    let md = `# 🏔️ TrailScout Trip Plan\n\n`;
    md += `## ${plan.recommendedTrailName}\n\n`;
    md += `> ${plan.whyChosen}\n\n`;
    md += `### Trip Info\n`;
    md += `- **Duration:** ${plan.estimatedDuration}\n`;
    md += `- **Trip type:** ${isMultiDay ? `${tripLengthDays} day backpacking trip` : 'Day hike'}\n`;
    if (nearestAirport) {
      md += `- **Nearest airport:** ${nearestAirport.airport.code} (${nearestAirport.airport.city}), ~${nearestAirport.distToTrailheadKm} km from trailhead\n`;
    }
    if (trail.elevationGainM != null && trail.elevationLossM != null) {
      md += `- **Elevation gain / loss:** ${trail.elevationGainM} m / ${trail.elevationLossM} m (DEM along trail)\n`;
    }
    md += `- **Mapped OSM path:** ${distKm.toFixed(1)} km (${(distKm * 0.621371).toFixed(1)} mi)\n`;
    if (targetHikeKm != null && targetHikeKm > 0) {
      md += `- **Your target length:** ~${targetHikeKm.toFixed(1)} km${isMultiDay ? ` across ${tripLengthDays} days` : ''}\n`;
    }
    md += `\n### Conditions\n`;
    md += `- **Weather:** ${plan.weatherSummary}\n`;
    md += `- **Trail:** ${plan.conditionsSummary}\n\n`;
    if (multiDayItinerary && multiDayItinerary.days.length > 1) {
      md += `### Itinerary (${multiDayItinerary.totalKm} km total, ${multiDayItinerary.campsitesFound} campsites)\n`;
      for (const seg of multiDayItinerary.days) {
        const camp = seg.campsite && seg.day < multiDayItinerary.days.length ? ` → Camp: ${seg.campsite.name}` : '';
        const source = seg.campsiteRecommendation?.source ? ` Source: ${seg.campsiteRecommendation.source}.` : '';
        md += `- **Day ${seg.day}:** ${buildDaySegmentLabel(multiDayItinerary, seg)} (km ${seg.startKm}–${seg.endKm}) — ${seg.notes}${source}${camp}\n`;
      }
      md += `\n`;
    } else if (dailyPlan.length > 0) {
      md += `### Daily Plan\n`;
      dailyPlan.forEach((item, i) => { md += `- Day ${i + 1}: ${item}\n`; });
      md += `\n`;
    }
    md += `### Route Notes\n${plan.routeNotes}\n\n`;
    if (logisticsNotes.length > 0) {
      md += `### Logistics\n`;
      logisticsNotes.forEach(note => { md += `- ${note}\n`; });
      md += `\n`;
    }
    if (travelPlan) {
      md += `### Getting There\n`;
      travelPlan.notes.forEach(note => { md += `- ${note}\n`; });
      md += `\n**Nearest Airports:**\n`;
      travelPlan.nearestAirports.forEach(({ airport, distToTrailheadKm }) => {
        md += `- ${airport.code} — ${airport.name} (${distToTrailheadKm} km)${airport.hub ? ' ✈ Hub' : ''}\n`;
      });
      if (travelPlan.groundTransport.length > 0) {
        md += `\n**Ground Transport:**\n`;
        travelPlan.groundTransport.forEach(t => {
          md += `- **${t.mode}**${t.estimatedTime ? ` (${t.estimatedTime})` : ''}: ${t.description}\n`;
        });
      }
      md += `\n`;
    }
    if (trainingProgram) {
      md += `### Suggested Training Plan\n`;
      md += `- **Effort tier:** ${trainingProgram.effortTier}\n`;
      md += `- **Peak day hike target:** ~${trainingProgram.peakTargets.longHikeKm} km — hardest expected training day, not full trip distance\n`;
      md += `- **Peak climb:** ~${trainingProgram.peakTargets.climbM} m\n`;
      md += `- **Pack practice:** up to ~${trainingProgram.peakTargets.packWeightKg} kg\n`;
      if (trainingProgram.conditionModifier.factors.length > 0) {
        md += `- **Condition modifier:** ${trainingProgram.conditionModifier.factors.join(', ')} (${trainingProgram.conditionModifier.multiplier}x)\n`;
      }
      trainingProgram.actionItems.forEach(item => { md += `- ${item}\n`; });
      md += `\n`;
    }
    md += `### What to Bring\n`;
    bringItems.forEach(item => { md += `- ${item}\n`; });
    md += `\n### Safety Notes\n`;
    const safetyLines = Array.isArray(plan.safetyNotes) ? plan.safetyNotes : [String(plan.safetyNotes)];
    safetyLines.forEach((note) => {
      md += `- ⚠️ ${note}\n`;
    });
    md += `\n### Packing Checklist\n`;
    checklistItems.forEach((item) => {
      md += `- [ ] ${item}\n`;
    });
    if (plan.backupTrailName !== 'None') {
      md += `\n### Backup Option\n`;
      md += `**${plan.backupTrailName}** — ${plan.backupReason}\n`;
    }
    md += `\n---\n*Generated by TrailScout Multi-Agent Planning Engine*\n`;

    const blob = new Blob([md], { type: 'text/markdown' });
    triggerDownload(blob, `trailscout_plan_${trail.name?.replace(/\s+/g, '_') || 'trip'}.md`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Back button */}
      <motion.button
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-offwhite/60 hover:text-teal transition-colors mb-6 group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to results
      </motion.button>

      {plannerRecommendation?.status === 'none' && (
        <div className="mb-6 rounded-2xl border border-red/30 bg-red/10 px-4 py-3">
          <div className="text-[10px] font-bold text-red uppercase tracking-wider mb-1">No auto-selected trail</div>
          <p className="text-sm text-offwhite/80">
            This page shows context from your search. Follow safety notes below — do not treat match scores as approval.
          </p>
        </div>
      )}

      {plannerRecommendation?.status === 'conditional' && (
        <div className="mb-6 rounded-2xl border border-amber/35 bg-amber/10 px-4 py-3">
          <div className="text-[10px] font-bold text-amber uppercase tracking-wider mb-1">Higher-risk itinerary</div>
          <p className="text-sm text-offwhite/80">
            Deterministic checks flagged elevated hazard or uncertainty. Confirm conditions with a local source before committing.
          </p>
        </div>
      )}

      {/* Hero and map row */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        {!isMultiDay && (
          <div className="relative rounded-3xl overflow-hidden min-h-[20rem] lg:min-h-[28rem] lg:col-span-1">
            <img
              src={imageUrl}
              alt={trail.name}
              className="absolute inset-0 w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/75 to-navy/10" />
            <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    plan.recommendedTrailId === 0
                      ? 'bg-red/25 text-red border border-red/30'
                      : plannerRecommendation?.status === 'conditional'
                        ? 'bg-amber/25 text-amber border border-amber/35'
                        : 'gradient-teal text-navy'
                  }`}
                >
                  {plan.recommendedTrailId === 0
                    ? 'No primary pick'
                    : plannerRecommendation?.status === 'conditional'
                      ? 'Conditional pick'
                      : '#1 Recommended'}
                </div>
                <div
                  className={`backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    plan.recommendedTrailId === 0 ? 'bg-white/5 text-offwhite/45' : 'bg-white/10 text-offwhite'
                  }`}
                >
                  <Star className={`w-3 h-3 ${plan.recommendedTrailId === 0 ? 'text-offwhite/35' : 'text-amber'}`} />{' '}
                  {candidate.matchScore}% Match
                </div>
              </div>
              <h1 className="font-display text-3xl md:text-4xl font-bold text-offwhite mb-2">
                {trail.name || 'Unnamed Trail'}
              </h1>
              <p className="text-offwhite/70 text-sm">{plan.whyChosen}</p>
            </div>
          </div>
        )}

        <div className={`glass-bright rounded-3xl p-4 ${isMultiDay ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
          <div className={`${isMultiDay ? 'min-h-[24rem] lg:min-h-[42rem]' : 'h-full min-h-[20rem] lg:min-h-[28rem]'} rounded-[1.25rem] overflow-hidden border border-white/10`}>
            <MapContainer
              trails={[{ ...trail, tags: { ...trail.tags, color: '#FF7D0F' } }]}
              focusedTrailId={trail.id}
              poiMarkers={poiMarkers}
            />
          </div>
          {isMultiDay ? (
            <div className="mt-4 px-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    plan.recommendedTrailId === 0
                      ? 'bg-red/25 text-red border border-red/30'
                      : plannerRecommendation?.status === 'conditional'
                        ? 'bg-amber/25 text-amber border border-amber/35'
                        : 'gradient-teal text-navy'
                  }`}
                >
                  {plan.recommendedTrailId === 0
                    ? 'No primary pick'
                    : plannerRecommendation?.status === 'conditional'
                      ? 'Conditional pick'
                      : '#1 Recommended'}
                </div>
                <div
                  className={`backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    plan.recommendedTrailId === 0 ? 'bg-white/5 text-offwhite/45' : 'bg-white/10 text-offwhite'
                  }`}
                >
                  <Star className={`w-3 h-3 ${plan.recommendedTrailId === 0 ? 'text-offwhite/35' : 'text-amber'}`} />{' '}
                  {candidate.matchScore}% Match
                </div>
              </div>
              <h1 className="font-display text-3xl md:text-5xl font-bold text-offwhite mb-2">
                {trail.name || 'Unnamed Trail'}
              </h1>
              <p className="text-offwhite/70 text-sm md:text-base max-w-4xl">{plan.whyChosen}</p>
              <p className="text-[11px] text-offwhite/40 mt-3">
                Full-width backpacking map is focused on the selected trail and planned camp nights.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-offwhite/40 mt-3 px-1">
              Map is focused on the selected trail only.
            </p>
          )}
        </div>
      </div>

      {(() => {
        const isUsfs = (trail.tags.trailscout_source ?? '').includes('usfs_nfs');
        const wilderness = trail.tags.wilderness_name;
        if (!isUsfs && !wilderness) return null;
        const vintage = isUsfs ? getDataVintage() : null;
        return (
          <div className="mb-6 space-y-2">
            {isUsfs && vintage && (
              <div className="flex items-start gap-3 glass-bright border border-amber/25 rounded-2xl px-4 py-3 text-left">
                <Shield className="w-5 h-5 text-amber shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-amber uppercase tracking-wider mb-0.5">
                    USDA Forest Service — {vintage.forestName}
                  </div>
                  <p className="text-[11px] text-offwhite/60 leading-snug">
                    {vintage.attribution} Data refreshed {vintage.fetchedAt.slice(0, 10)}.
                  </p>
                </div>
              </div>
            )}
            {wilderness && (
              <div className="flex items-start gap-3 glass-bright border border-green/25 rounded-2xl px-4 py-3 text-left">
                <Shield className="w-5 h-5 text-green shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold text-green uppercase tracking-wider mb-0.5">
                    {wilderness}
                  </div>
                  <p className="text-[11px] text-offwhite/60 leading-snug">
                    No mechanized travel, no bicycles. Group size limits may apply. Check USFS for current permit requirements and closures before departing.
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { icon: Navigation, label: 'Distance', value: `${distKm.toFixed(1)} km`, color: 'text-teal' },
          {
            icon: TrendingUp,
            label: 'Elev. gain',
            value: trail.elevationGainM != null ? `${trail.elevationGainM} m` : '—',
            color: 'text-green',
          },
          {
            icon: TrendingDown,
            label: 'Elev. loss',
            value: trail.elevationLossM != null ? `${trail.elevationLossM} m` : '—',
            color: 'text-amber',
          },
          { icon: Clock, label: 'Duration', value: plan.estimatedDuration, color: 'text-blue' },
          {
            icon: Plane,
            label: 'Nearest Airport',
            value: travelPlan?.nearestAirports[0]
              ? `${travelPlan.nearestAirports[0].airport.code} (${travelPlan.nearestAirports[0].distToTrailheadKm} km)`
              : '—',
            color: 'text-purple',
          },
          {
            icon: Gauge,
            label: 'Effort',
            value: effortTier ?? '—',
            color: effortColor,
            sub: effortEstimate ? `~${effortEstimate.adjustedTimeHours} h hiking` : undefined,
          },
        ].map(({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string; color: string; sub?: string }) => (
          <div key={label} className="glass-bright rounded-2xl p-4 text-center">
            <Icon className={`w-5 h-5 ${color} mx-auto mb-2`} />
            <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">{label}</div>
            <div className="text-sm font-bold text-offwhite">{value}</div>
            {sub && <div className="text-[10px] text-offwhite/35 mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        {/* Left column: Plan details */}
        <div className="md:col-span-2 space-y-6">
          {/* Schedule card */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-teal" /> {isMultiDay ? 'Trip Timeline' : 'Trip Schedule'}
            </h3>
            <div className="space-y-3">
              {isMultiDay && multiDayItinerary && multiDayItinerary.days.length > 1 ? (
                <>
                  <TimelineItem
                    time="Start"
                    label={
                      multiDayItinerary.entryTrailhead
                        ? `${trailheadArrivalLabel} Entry: ${multiDayItinerary.entryTrailhead.name} trailhead.`
                        : trailheadArrivalLabel
                    }
                    icon="📍"
                  />
                  {multiDayItinerary.days.map((seg) => {
                    const isLast = seg.day === multiDayItinerary.days.length;
                    const icon = isLast ? '🏁' : !seg.approvedSite ? '⚠️' : seg.day === 1 ? '🥾' : '⛺';
                    return (
                      <React.Fragment key={seg.day}>
                        <TimelineItem
                          time={`Day ${seg.day}`}
                          label={
                            <span>
                              <span className="text-teal font-semibold tabular-nums">{buildDaySegmentLabel(multiDayItinerary, seg)}</span>
                              {seg.effortHours != null && (
                                <span className="text-blue/70 ml-1 text-[11px]">~{seg.effortHours} h</span>
                              )}
                              {' '}
                              <span className="text-offwhite/50">(km {seg.startKm}–{seg.endKm})</span>
                              {seg.wilderness && (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-amber/70 bg-amber/10 px-1.5 py-0.5 rounded">Wilderness</span>
                              )}
                              <span className="block mt-1 text-[12px] text-offwhite/70 leading-relaxed">{seg.notes}</span>
                              {seg.campsite && !isLast && (
                                <span className="block mt-1 text-[11px] text-offwhite/45 flex items-center gap-1 flex-wrap">
                                  <Tent className="w-3 h-3 inline" />
                                  {seg.campsite.name}
                                  {seg.campsite.water === true && <span className="text-blue/60 ml-1">· water</span>}
                                  {seg.campsite.water === false && <span className="text-red/50 ml-1">· no water</span>}
                                  {seg.campsite.fee && <span className="text-amber/60 ml-1">· fee</span>}
                                  {seg.campsiteStatus ? (
                                    <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                      statusColor(seg.campsiteStatus) === 'emerald' ? 'text-emerald-400/80 bg-emerald-400/10' :
                                      statusColor(seg.campsiteStatus) === 'sky' ? 'text-sky-400/80 bg-sky-400/10' :
                                      statusColor(seg.campsiteStatus) === 'amber' ? 'text-amber/80 bg-amber/10' :
                                      'text-red/80 bg-red/10'
                                    }`}>
                                      {statusLabel(seg.campsiteStatus)}
                                      {seg.campsiteConfidence != null && ` · ${seg.campsiteConfidence}%`}
                                    </span>
                                  ) : (
                                    seg.approvedSite && <span className="text-green/50 ml-1">· USFS approved</span>
                                  )}
                                  {seg.campsiteSources && seg.campsiteSources.length > 0 && (
                                    <span className="text-[9px] text-offwhite/25 ml-1">
                                      ({seg.campsiteSources.join(' + ')})
                                    </span>
                                  )}
                                </span>
                              )}
                              {!seg.approvedSite && !isLast && (
                                <span className="block mt-1 text-[11px] text-red/60 font-semibold flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 inline" /> {seg.campsiteRecommendation?.officialCampingFacility
                                    ? 'Official campsite data found — verify current availability before camping here'
                                    : 'No confirmed public-data campsite for this segment'}
                                </span>
                              )}
                            </span>
                          }
                          icon={icon}
                        />
                      </React.Fragment>
                    );
                  })}
                  <TimelineItem
                    time="Finish"
                    label={
                      multiDayItinerary.exitTrailhead
                        ? `Exit at ${multiDayItinerary.exitTrailhead.name} trailhead. Plan to be off trail by ${plan.expectedReturnTime}.`
                        : `Plan to be off trail by ${plan.expectedReturnTime}.`
                    }
                    icon="✅"
                  />

                  {campNightCoverage.expected > 0 && (
                    <div className={`mt-3 p-3 rounded-lg border ${campNightCoverage.complete ? 'bg-teal/5 border-teal/15' : 'bg-amber/5 border-amber/15'}`}>
                      <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${campNightCoverage.complete ? 'text-teal' : 'text-amber'}`}>
                        Camp nights mapped: {campNightCoverage.mapped}/{campNightCoverage.expected}
                      </div>
                      <p className="text-xs text-offwhite/60">
                        The map shows only selected itinerary camp-night markers plus trailheads; nearby non-selected campgrounds are hidden to avoid confusing them with planned overnight stops.
                      </p>
                    </div>
                  )}

                  {multiDayItinerary.warnings.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-amber/5 border border-amber/15">
                      <div className="text-[10px] font-bold text-amber uppercase tracking-wider mb-1">Warnings</div>
                      <ul className="text-xs text-offwhite/60 space-y-1">
                        {multiDayItinerary.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Fire alert banner */}
                  {forestAlerts && forestAlerts.hasActiveFiresInArea && (
                    <div className="mt-3 p-3 rounded-lg bg-red/10 border border-red/30">
                      <div className="text-[10px] font-bold text-red uppercase tracking-wider mb-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Active Fire Alert
                      </div>
                      <ul className="text-xs text-offwhite/70 space-y-1">
                        {forestAlerts.incidents.filter(i => i.isActive).map(inc => (
                          <li key={inc.id}>
                            {inc.name} — {inc.acres.toLocaleString()} acres
                            {inc.containment != null && `, ${inc.containment}% contained`}
                          </li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-red/60 mt-1">
                        Check fs.usda.gov and InciWeb for current closures before departing.
                      </p>
                    </div>
                  )}

                  <div className="mt-3 p-3 rounded-lg bg-white/3 border border-white/8">
                    <p className="text-[11px] text-offwhite/40 leading-relaxed">
                      <Shield className="w-3 h-3 inline mr-1 text-offwhite/30" />
                      {multiDayItinerary.disclaimer}
                    </p>
                  </div>

                  {/* Data provenance card */}
                  {multiDayItinerary.hasStatusData && (
                    <div className="mt-3 p-3 rounded-lg bg-white/3 border border-white/8">
                      <div className="text-[10px] font-bold text-offwhite/50 uppercase tracking-wider mb-2">Data Sources</div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400/70 border border-emerald-400/20">USFS EDW</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-sky-400/10 text-sky-400/70 border border-sky-400/20">Recreation.gov</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-400/10 text-orange-400/70 border border-orange-400/20">NIFC Fire Data</span>
                      </div>
                      <p className="text-[10px] text-offwhite/30 mt-1.5">
                        Campsite status reflects data from {campsiteStatuses?.length ?? 0} sites cross-referenced across sources.
                        {forestAlerts && ` Fire data: ${forestAlerts.fetchedAt.slice(0, 10)}.`}
                      </p>
                    </div>
                  )}
                </>
              ) : isMultiDay ? (
                <>
                  <TimelineItem
                    time="Start"
                    label={trailheadArrivalLabel}
                    icon="📍"
                  />
                  {(dailyPlan.length > 0 ? dailyPlan : [plan.routeNotes]).map((item, i) => (
                    <React.Fragment key={`${item}-${i}`}>
                      <TimelineItem
                        time={`Day ${i + 1}`}
                        label={item}
                        icon={i === tripLengthDays - 1 ? '🏁' : i === 0 ? '🥾' : '⛺'}
                      />
                    </React.Fragment>
                  ))}
                  <TimelineItem time="Finish" label={`Plan to be off trail by ${plan.expectedReturnTime}.`} icon="✅" />
                </>
              ) : (
                <>
                  <TimelineItem time="Start" label={trailheadArrivalLabel} icon="📍" />
                  <TimelineItem time="" label={plan.routeNotes} icon="🥾" isNote />
                  <TimelineItem time="Duration" label={plan.estimatedDuration} icon="⏱️" />
                </>
              )}
            </div>
          </div>

          {/* Campsite Itinerary Summary */}
          {multiDayItinerary && multiDayItinerary.days.length > 1 && (
            <div className="glass-bright rounded-2xl p-6">
              <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
                <Tent className="w-5 h-5 text-green" /> Itinerary Summary
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">Total Distance</div>
                  <div className="font-display font-bold text-teal text-lg tabular-nums">{multiDayItinerary.totalKm} km</div>
                  <div className="text-[10px] text-offwhite/35">{(multiDayItinerary.totalKm * 0.621371).toFixed(1)} mi</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">Days</div>
                  <div className="font-display font-bold text-offwhite text-lg tabular-nums">{multiDayItinerary.days.length}</div>
                  <div className="text-[10px] text-offwhite/35">~{(multiDayItinerary.totalKm / multiDayItinerary.days.length).toFixed(0)} km/day</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">Approved Sites</div>
                  <div className="font-display font-bold text-green text-lg tabular-nums">
                    {multiDayItinerary.days.filter(d => d.approvedSite && d.day < multiDayItinerary.days.length).length}
                  </div>
                  <div className="text-[10px] text-offwhite/35">of {multiDayItinerary.days.length - 1} nights</div>
                </div>
              </div>
              <div className="space-y-2">
                {multiDayItinerary.days.map((seg) => (
                  <div key={seg.day} className="flex items-center gap-3 text-xs">
                    <span className="w-12 shrink-0 font-bold text-offwhite/50">Day {seg.day}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal/60 to-teal/30"
                        style={{ width: `${Math.min(100, (seg.distanceKm / multiDayItinerary.totalKm) * 100 * multiDayItinerary.days.length)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right tabular-nums text-offwhite/60">{seg.distanceKm} km</span>
                    {seg.effortHours != null && (
                      <span className="w-12 text-right tabular-nums text-blue/50 text-[10px]">{seg.effortHours} h</span>
                    )}
                    {seg.day < multiDayItinerary.days.length && (
                      seg.campsiteStatus ? (
                        <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                          statusColor(seg.campsiteStatus) === 'emerald' ? 'text-emerald-400/80 bg-emerald-400/10' :
                          statusColor(seg.campsiteStatus) === 'sky' ? 'text-sky-400/80 bg-sky-400/10' :
                          statusColor(seg.campsiteStatus) === 'amber' ? 'text-amber/80 bg-amber/10' :
                          'text-red/80 bg-red/10'
                        }`}>{statusLabel(seg.campsiteStatus)}</span>
                      ) : seg.approvedSite
                        ? <Tent className="w-3 h-3 text-green/50 shrink-0" />
                        : <AlertTriangle className="w-3 h-3 text-red/50 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conditions */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <CloudRain className="w-5 h-5 text-blue" /> Conditions & Weather
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-4">
                <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">Weather</div>
                <p className="text-sm text-offwhite/80">{plan.weatherSummary}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">Trail Conditions</div>
                <p className="text-sm text-offwhite/80">{plan.conditionsSummary}</p>
              </div>
            </div>
            <p className="text-[11px] text-offwhite/40 mt-4 leading-relaxed border-t border-white/10 pt-4">
              Mapped OSM path:{' '}
              <span className="text-offwhite/65 tabular-nums">
                {distKm.toFixed(1)} km ({(distKm * 0.621371).toFixed(1)} mi)
              </span>
              {trail.tags.trailscout_source === 'osm_relation' && (
                <span className="text-offwhite/30"> · merged hiking route</span>
              )}
              {trail.tags.trailscout_source === 'osm_way_segment' && (
                <span className="text-offwhite/30"> · single mapped segment</span>
              )}
              {targetHikeKm != null && targetHikeKm > 0 && (
                <>
                  {' '}
                  · Your target ~{targetHikeKm.toFixed(1)} km{isMultiDay ? ` across ${tripLengthDays} days` : ''}. Real distance may differ if the trail continues off the mapped geometry.
                </>
              )}
            </p>
          </div>

          {/* Validation checks */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-green" /> Validation Checks
            </h3>
            <div className="space-y-2">
              {validation.passedChecks.map((check, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-green/80">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{check}</span>
                </div>
              ))}
              {validation.warnings.map((warn, i) => (
                <div key={`w-${i}`} className="flex items-center gap-2 text-sm text-amber/80">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{warn}</span>
                </div>
              ))}
              {validation.risks.map((risk, i) => (
                <div key={`r-${i}`} className="flex items-center gap-2 text-sm text-red/80">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{risk}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2">
              <span className="text-[10px] text-offwhite/40 uppercase tracking-wider">Confidence</span>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${validation.confidenceScore}%` }}
                  transition={{ duration: 1, delay: 0.5 }}
                  className="h-full gradient-teal rounded-full"
                />
              </div>
              <span className="text-sm font-bold text-teal">{validation.confidenceScore}%</span>
            </div>
          </div>

          {/* Assumption Ledger */}
          {assumptions.length > 0 && (
            <div className="glass-bright rounded-2xl p-6">
              <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber" /> Assumptions & Caveats
              </h3>
              <div className="space-y-2">
                {assumptions
                  .sort((a, b) => {
                    const sev = { critical: 0, warning: 1, info: 2 };
                    return sev[a.severity] - sev[b.severity];
                  })
                  .map((a, i) => (
                  <div key={i} className={`flex items-start gap-2 text-sm ${
                    a.severity === 'critical' ? 'text-red/80' :
                    a.severity === 'warning' ? 'text-amber/80' :
                    'text-offwhite/60'
                  }`}>
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      a.severity === 'critical' ? 'bg-red' :
                      a.severity === 'warning' ? 'bg-amber' :
                      'bg-offwhite/30'
                    }`} />
                    <div className="flex-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-offwhite/30 mr-2">{a.stage}</span>
                      {a.text}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-offwhite/25 mt-3 border-t border-white/5 pt-3">
                These assumptions were logged by the deterministic pipeline. Verify critical items with local authorities before your trip.
              </p>
            </div>
          )}

          {/* Backup */}
          {plan.backupTrailName && plan.backupTrailName !== 'None' && (
            <div className="glass-bright rounded-2xl p-6 border border-orange/20">
              <h3 className="font-display font-bold text-lg text-offwhite mb-2 flex items-center gap-2">
                <Compass className="w-5 h-5 text-orange" /> Backup Option
              </h3>
              <p className="text-sm text-offwhite/70 mb-1">
                <span className="font-semibold text-orange">{plan.backupTrailName}</span>
              </p>
              <p className="text-xs text-offwhite/50">{plan.backupReason}</p>
            </div>
          )}
        </div>

        {/* Right column: Gear & Actions */}
        <div className="space-y-6">
          {/* Action buttons */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <CalendarPlus className="w-5 h-5 text-teal" /> Action Items
            </h3>
            <div className="space-y-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAddCalendar}
                className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-sm transition-all ${
                  calendarAdded 
                    ? 'bg-green/20 text-green border border-green/30' 
                    : 'gradient-teal text-navy hover:shadow-lg glow-teal'
                }`}
              >
                {calendarAdded ? <CheckCircle2 className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
                {calendarAdded ? 'Calendar Event Downloaded!' : 'Add to Calendar'}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleShare}
                className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-sm transition-all ${
                  shared
                    ? 'bg-blue/20 text-blue border border-blue/30'
                    : 'bg-blue/10 text-blue border border-blue/20 hover:bg-blue/20'
                }`}
              >
                {shared ? <CheckCircle2 className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {shared ? 'Shared!' : 'Share Plan'}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSaved(true)}
                className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-sm transition-all ${
                  saved
                    ? 'bg-purple/20 text-purple border border-purple/30'
                    : 'bg-purple/10 text-purple border border-purple/20 hover:bg-purple/20'
                }`}
              >
                {saved ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                {saved ? 'Hike Saved!' : 'Save Hike'}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold text-sm bg-white/5 text-offwhite/60 border border-white/10 hover:bg-white/10 transition-all"
              >
                <Download className="w-4 h-4" />
                Download Full Plan
              </motion.button>
            </div>
          </div>

          {trainingProgram && (
            <div className="glass-bright rounded-2xl p-6 border border-teal/15">
              <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal" /> Suggested Training Plan
              </h3>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[9px] text-offwhite/40 uppercase tracking-wider mb-1">Peak day hike</div>
                  <div className="text-sm font-bold text-teal tabular-nums">{trainingProgram.peakTargets.longHikeKm} km</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[9px] text-offwhite/40 uppercase tracking-wider mb-1">Climb</div>
                  <div className="text-sm font-bold text-green tabular-nums">{trainingProgram.peakTargets.climbM} m</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <div className="text-[9px] text-offwhite/40 uppercase tracking-wider mb-1">Pack</div>
                  <div className="text-sm font-bold text-amber tabular-nums">{trainingProgram.peakTargets.packWeightKg} kg</div>
                </div>
              </div>
              {trainingProgram.conditionModifier.factors.length > 0 && (
                <div className="mb-3 rounded-xl bg-amber/10 border border-amber/20 px-3 py-2">
                  <div className="text-[9px] font-bold text-amber uppercase tracking-wider mb-1">
                    Condition-adjusted · {trainingProgram.conditionModifier.multiplier}x
                  </div>
                  <p className="text-xs text-offwhite/65">{trainingProgram.conditionModifier.factors.join(', ')}</p>
                </div>
              )}
              <div className="space-y-2">
                {trainingProgram.actionItems.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-offwhite/70">
                    <ChevronRight className="w-3 h-3 text-teal mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleDownloadTrainingProgram}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-xs bg-teal/10 text-teal border border-teal/20 hover:bg-teal/20 transition-all"
              >
                <Download className="w-4 h-4" />
                Download Training Program
              </motion.button>
              <p className="text-[10px] text-offwhite/35 mt-3 border-t border-white/5 pt-3 leading-relaxed">
                {trainingProgram.disclaimer}
              </p>
            </div>
          )}

          {/* Safety notes */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red" /> Safety Notes
            </h3>
            <div className="space-y-2">
              {Array.isArray(plan.safetyNotes) ? plan.safetyNotes.map((note, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-offwhite/70">
                  <AlertTriangle className="w-3 h-3 text-amber mt-0.5 flex-shrink-0" />
                  <span>{note}</span>
                </div>
              )) : (
                <p className="text-sm text-offwhite/70 italic text-center">Safety first: stay on trails.</p>
              )}
            </div>
          </div>

          {logisticsNotes.length > 0 && (
            <div className="glass-bright rounded-2xl p-6">
              <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
                <Tent className="w-5 h-5 text-teal" /> Camp & Logistics
              </h3>
              <div className="space-y-2">
                {logisticsNotes.map((note, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-offwhite/70">
                    <ChevronRight className="w-3 h-3 text-teal mt-0.5 flex-shrink-0" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Travel logistics */}
          {travelPlan && (
            <div className="glass-bright rounded-2xl p-6">
              <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
                <Plane className="w-5 h-5 text-purple" /> Getting There
              </h3>

              {/* Origin acknowledgment + notes */}
              <div className="space-y-2 mb-4">
                {travelPlan.notes.map((note, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-offwhite/80">
                    <Navigation className="w-3 h-3 text-purple mt-0.5 flex-shrink-0" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>

              {/* Nearest airports */}
              <div className="mb-4">
                <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-2">Nearest Airports</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {travelPlan.nearestAirports.map(({ airport, distToTrailheadKm }) => (
                    <div key={airport.code} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                      <Plane className="w-4 h-4 text-teal flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-offwhite truncate">
                          {airport.code} — {airport.city}
                          {airport.hub && <span className="ml-1 text-[10px] bg-purple/20 text-purple px-1.5 py-0.5 rounded-full">Hub</span>}
                        </div>
                        <div className="text-xs text-offwhite/50">{distToTrailheadKm} km to trail area</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ground transport */}
              {travelPlan.groundTransport.length > 0 && (
                <div>
                  <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-2">Ground Transportation</div>
                  <div className="space-y-2">
                    {travelPlan.groundTransport.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-offwhite/70">
                        <Car className="w-4 h-4 text-orange mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-offwhite/90">{t.mode}</span>
                          {t.estimatedTime && <span className="text-teal ml-1">({t.estimatedTime})</span>}
                          <p className="text-xs text-offwhite/50 mt-0.5">{t.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Packing checklist toggle */}
          <div className="glass-bright rounded-2xl p-6">
            <button
              onClick={() => setShowChecklist(!showChecklist)}
              className="w-full flex items-center justify-between"
            >
              <h3 className="font-display font-bold text-lg text-offwhite flex items-center gap-2">
                <Package className="w-5 h-5 text-purple" /> Packing Checklist
              </h3>
              <ChevronRight className={`w-5 h-5 text-offwhite/40 transition-transform ${showChecklist ? 'rotate-90' : ''}`} />
            </button>
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Backpack className="w-4 h-4 text-orange" /> What to Bring
              </div>
              {bringItems.length > 0 ? (
                <div className="space-y-2">
                  {bringItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-offwhite/70">
                      <ChevronRight className="w-3 h-3 text-teal flex-shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-offwhite/70 italic text-center">Standard hiking essentials recommended.</p>
              )}
            </div>
            <AnimatePresence>
              {showChecklist && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 space-y-2"
                >
                  {Array.isArray(plan.packingChecklist) ? plan.packingChecklist.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm text-offwhite/70 cursor-pointer group">
                      <input type="checkbox" className="accent-teal w-4 h-4 rounded border-white/10" />
                      <span className="group-has-[:checked]:line-through group-has-[:checked]:text-offwhite/30 transition-all flex items-center gap-2">
                        {item}
                      </span>
                    </label>
                  )) : (
                    <p className="text-sm text-offwhite/70 italic text-center">Standard hiking essentials recommended.</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Timeline sub-component
function TimelineItem({ time, label, icon, isNote = false }: { time: string; label: string; icon: string; isNote?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-16 text-right">
        <span className="text-xs font-bold text-teal">{time}</span>
      </div>
      <div className="flex-shrink-0 flex flex-col items-center">
        <span className="text-lg">{icon}</span>
        <div className="w-px h-4 bg-white/10" />
      </div>
      <div className={`flex-1 ${isNote ? 'text-xs text-offwhite/50 italic' : 'text-sm text-offwhite/70'}`}>
        {label}
      </div>
    </div>
  );
}

export default TripPlanView;
