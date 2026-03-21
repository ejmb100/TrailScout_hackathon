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
} from 'lucide-react';
import type { IntentProfile, TripPlan, TrailCandidate, ValidationResult } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import { calculateDistance } from '../utils/trailScoring';
import MapContainer from './MapContainer';

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
  const bringItems = checklistItems.length > 0
    ? checklistItems.slice(0, 6)
    : Array.isArray(plan.whatToBring)
      ? plan.whatToBring
      : [];

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailscout_${trail.name?.replace(/\s+/g, '_') || 'hike'}.ics`;
    a.click();
    URL.revokeObjectURL(url);
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

  // Download full plan
  const handleDownload = () => {
    let md = `# 🏔️ TrailScout Trip Plan\n\n`;
    md += `## ${plan.recommendedTrailName}\n\n`;
    md += `> ${plan.whyChosen}\n\n`;
    md += `### Schedule\n`;
    md += `- **Depart:** ${plan.departureTime}\n`;
    md += `- **Return:** ${plan.expectedReturnTime}\n`;
    md += `- **Duration:** ${plan.estimatedDuration}\n`;
    md += `- **Drive:** ${plan.driveTime}\n`;
    md += `- **Trip type:** ${isMultiDay ? `${tripLengthDays} day backpacking trip` : 'Day hike'}\n`;
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
    if (dailyPlan.length > 0) {
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
    md += `### What to Bring\n`;
    bringItems.forEach(item => { md += `- ${item}\n`; });
    md += `\n### Safety Notes\n`;
    plan.safetyNotes.forEach(note => { md += `- ⚠️ ${note}\n`; });
    md += `\n### Packing Checklist\n`;
    plan.packingChecklist.forEach(item => { md += `- [ ] ${item}\n`; });
    if (plan.backupTrailName !== 'None') {
      md += `\n### Backup Option\n`;
      md += `**${plan.backupTrailName}** — ${plan.backupReason}\n`;
    }
    md += `\n---\n*Generated by TrailScout Multi-Agent Planning Engine*\n`;

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailscout_plan_${trail.name?.replace(/\s+/g, '_') || 'trip'}.md`;
    a.click();
    URL.revokeObjectURL(url);
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

      {/* Hero banner */}
      <div className="relative rounded-3xl overflow-hidden mb-8">
        <div className="h-64 md:h-80">
          <img
            src={imageUrl}
            alt={trail.name}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/60 to-transparent" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="gradient-teal px-3 py-1 rounded-full text-[10px] font-bold text-navy uppercase tracking-wider">
              #1 Recommended
            </div>
            <div className="bg-white/10 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold text-offwhite flex items-center gap-1">
              <Star className="w-3 h-3 text-amber" /> {candidate.matchScore}% Match
            </div>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-offwhite mb-2">
            {trail.name || 'Unnamed Trail'}
          </h1>
          <p className="text-offwhite/70 text-sm max-w-2xl">{plan.whyChosen}</p>
        </div>
      </div>

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
          { icon: MapPin, label: 'Drive Time', value: plan.driveTime, color: 'text-purple' },
          {
            icon: isMultiDay ? Tent : Sun,
            label: isMultiDay ? 'Trip Length' : 'Depart',
            value: isMultiDay ? `${tripLengthDays} day${tripLengthDays === 1 ? '' : 's'}` : plan.departureTime,
            color: 'text-orange',
          },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="glass-bright rounded-2xl p-4 text-center">
            <Icon className={`w-5 h-5 ${color} mx-auto mb-2`} />
            <div className="text-[10px] text-offwhite/40 uppercase tracking-wider mb-1">{label}</div>
            <div className="text-sm font-bold text-offwhite">{value}</div>
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
              {isMultiDay ? (
                <>
                  <TimelineItem
                    time="Start"
                    label={`Leave home at ${plan.departureTime} and reach the trailhead after about ${plan.driveTime}.`}
                    icon="🚗"
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
                  <TimelineItem time={plan.departureTime} label="Leave home" icon="🚗" />
                  <TimelineItem time={`+${plan.driveTime}`} label="Arrive at trailhead" icon="🅿️" />
                  <TimelineItem time="" label={plan.routeNotes} icon="🥾" isNote />
                  <TimelineItem time={plan.expectedReturnTime} label="Back at car" icon="✅" />
                </>
              )}
            </div>
          </div>

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

          {/* Trail map */}
          <div className="glass-bright rounded-2xl p-6">
            <h3 className="font-display font-bold text-lg text-offwhite mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-teal" /> Trail Map
            </h3>
            <div className="h-72 rounded-2xl overflow-hidden border border-white/10">
              <MapContainer
                trails={[{ ...trail, tags: { ...trail.tags, color: '#FF7D0F' } }]}
                focusedTrailId={trail.id}
              />
            </div>
            <p className="text-[11px] text-offwhite/40 mt-3">
              Map is focused on the selected trail only.
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
