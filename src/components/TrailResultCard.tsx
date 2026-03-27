import React from 'react';
import { motion } from 'motion/react';
import {
  MapPin,
  Clock,
  Mountain,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Star,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import type { TrailCandidate, ValidationResult } from '../services/geminiService';
import type { PlannerScoredCandidate } from '../planner';
import { estimateEffort, effortDifficultyTier, effortTierColor } from '../planner';
import type { TrailData } from '../services/osmService';
import { calculateDistance } from '../utils/trailScoring';

const trailImages = [
  'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&q=80&w=640&h=896',
  'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&q=80&w=640&h=896',
  'https://images.unsplash.com/photo-1533240332313-0db49b459ad6?auto=format&fit=crop&q=80&w=640&h=896',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&q=80&w=640&h=896',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=640&h=896',
];

interface TrailResultCardProps {
  trail: TrailData;
  candidate: TrailCandidate;
  validation?: ValidationResult;
  /** Deterministic planner assessment (gates, risk). */
  planner?: PlannerScoredCandidate;
  rank: number;
  isSelected: boolean;
  /** User's desired hike length from intent (km). */
  targetMaxKm?: number;
  onSelect: () => void;
}

const fitColors: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-green/25', text: 'text-green', label: 'Excellent' },
  good: { bg: 'bg-teal/25', text: 'text-teal', label: 'Good' },
  fair: { bg: 'bg-amber/25', text: 'text-amber', label: 'Fair' },
  poor: { bg: 'bg-red/25', text: 'text-red', label: 'Poor' },
};

function osmLengthLabel(tags: Record<string, string>): string {
  const src = tags.trailscout_source;
  if (src === 'osm_relation') return 'OSM route';
  if (src === 'osm_way_segment') return 'OSM segment';
  return 'OSM path';
}

const TrailResultCard: React.FC<TrailResultCardProps> = ({
  trail,
  candidate,
  validation,
  planner,
  rank,
  isSelected,
  targetMaxKm,
  onSelect,
}) => {
  const distKm = calculateDistance(trail.path);
  const distMi = (distKm * 0.621371).toFixed(1);
  const imageUrl = trailImages[rank % trailImages.length];
  const fit = validation ? fitColors[validation.overallFit] || fitColors.good : fitColors.good;
  const gatedOut = planner && !planner.eligible;
  const matchMuted = Boolean(gatedOut);
  const sacShort = trail.tags.sac_scale
    ? trail.tags.sac_scale.replace(/_/g, ' ').slice(0, 14)
    : null;
  const isUsfs = (trail.tags.trailscout_source ?? '').includes('usfs_nfs');
  const wildernessName = trail.tags.wilderness_name;

  const effort = estimateEffort(trail);
  const tier = effortDifficultyTier(effort, distKm);
  const tierColor = effortTierColor(tier);
  const tierBg = tierColor.replace('text-', 'bg-') + '/15';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.1, duration: 0.45 }}
      whileHover={{ y: -3, scale: 1.02 }}
      onClick={onSelect}
      className={`w-full max-w-[15rem] sm:max-w-[16rem] h-full cursor-pointer group rounded-md transition-all duration-300 ${
        isSelected
          ? 'ring-2 ring-teal ring-offset-2 ring-offset-navy shadow-[0_12px_40px_rgba(3,212,189,0.25)]'
          : 'shadow-[0_10px_36px_rgba(0,0,0,0.45)] hover:shadow-[0_14px_44px_rgba(0,0,0,0.55)]'
      }`}
      style={{
        borderWidth: 3,
        borderStyle: 'solid',
        borderColor: '#e4d5bc',
        background: 'linear-gradient(145deg, #efe6d4 0%, #d8ccb8 100%)',
      }}
    >
      <div className="m-[3px] rounded-[4px] border border-black/35 bg-navy-card flex flex-col overflow-hidden min-h-[17rem] h-full">
        {/* Trading-card banner */}
        <div className="gradient-orange flex items-center justify-between px-2.5 py-1 border-b border-black/20">
          <span className="text-[9px] font-extrabold tracking-[0.15em] text-navy uppercase font-display">
            TrailScout
          </span>
          <span className="text-[10px] font-black text-navy font-display tabular-nums">#{rank + 1}</span>
        </div>

        {/* Hero image — shorter than portrait trading card */}
        <div className="relative aspect-[4/3] w-full max-h-[7.5rem] sm:max-h-[8rem] shrink-0 overflow-hidden bg-navy-light">
          <img
            src={imageUrl}
            alt={trail.name}
            className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-700"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-card via-transparent to-navy/20" />

          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1">
            {validation && (
              <div
                className={`${fit.bg} ${fit.text} px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide flex items-center gap-0.5`}
              >
                <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                {fit.label}
              </div>
            )}
            <div
              className={`ml-auto flex items-center gap-0.5 rounded px-2 py-0.5 ${
                matchMuted ? 'bg-black/35 text-offwhite/45' : 'bg-black/55 text-offwhite'
              }`}
            >
              <Star className={`w-3 h-3 shrink-0 ${matchMuted ? 'text-offwhite/35' : 'text-amber'}`} />
              <span className="text-[10px] font-bold tabular-nums">{candidate.matchScore}%</span>
            </div>
          </div>
          {gatedOut && (
            <div className="absolute top-1.5 left-1.5 right-1.5 rounded bg-red/90 text-[8px] font-bold text-white uppercase tracking-wide text-center py-0.5 px-1">
              Did not pass gates
            </div>
          )}
        </div>

        {/* Card body — stats + copy */}
        <div className="flex flex-col flex-1 p-2 pt-1.5 gap-1.5 border-t border-white/6">
          <h3 className="font-display font-bold text-xs sm:text-sm text-offwhite text-center leading-tight line-clamp-2 min-h-0 group-hover:text-teal transition-colors">
            {trail.name || 'Unnamed Trail'}
          </h3>

          <p className="text-[8px] text-offwhite/35 text-center leading-tight px-0.5">
            {osmLengthLabel(trail.tags)} · {distKm.toFixed(1)} km ({distMi} mi) mapped
            {targetMaxKm != null && targetMaxKm > 0 && (
              <>
                {' '}
                <span className="text-offwhite/25">·</span> target ~{targetMaxKm.toFixed(0)} km
              </>
            )}
          </p>

          {/* 2×2 stats */}
          <div className="grid grid-cols-2 gap-1 text-[8px] sm:text-[9px]">
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold">Match</div>
              <div
                className={`font-display font-bold tabular-nums ${matchMuted ? 'text-offwhite/40' : 'text-amber'}`}
              >
                {candidate.matchScore}%
              </div>
            </div>
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold">Length</div>
              <div className="font-display font-bold text-teal tabular-nums leading-tight">
                {distKm.toFixed(1)} km
                <div className="text-[7px] sm:text-[8px] font-normal text-offwhite/45">{distMi} mi</div>
              </div>
            </div>
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold">Crowd</div>
              <div className="font-bold text-offwhite/90 capitalize truncate">{candidate.crowdLevel}</div>
            </div>
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold">Drive</div>
              <div className="font-bold text-offwhite/90 truncate" title={candidate.estimatedDriveTime}>
                {candidate.estimatedDriveTime}
              </div>
            </div>
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold flex items-center justify-center gap-0.5">
                <ArrowUpRight className="w-2.5 h-2.5 text-green" />
                Gain
              </div>
              <div className="font-display font-bold text-green tabular-nums">
                {trail.elevationGainM != null ? `${trail.elevationGainM} m` : '—'}
              </div>
            </div>
            <div className="rounded bg-black/25 border border-white/8 px-1.5 py-1 text-center">
              <div className="text-offwhite/35 uppercase tracking-wider font-bold flex items-center justify-center gap-0.5">
                <ArrowDownRight className="w-2.5 h-2.5 text-amber" />
                Loss
              </div>
              <div className="font-display font-bold text-amber tabular-nums">
                {trail.elevationLossM != null ? `${trail.elevationLossM} m` : '—'}
              </div>
            </div>
          </div>

          <p className="text-[9px] sm:text-[10px] text-offwhite/55 leading-snug line-clamp-2 border-l-2 border-teal/40 pl-1.5">
            {candidate.matchExplanation}
          </p>

          <div className="flex flex-wrap gap-1 justify-center">
            <span className={`inline-flex items-center gap-0.5 ${tierBg} px-1.5 py-0.5 rounded text-[8px] ${tierColor} font-bold`}>
              {tier}
            </span>
            <span className="inline-flex items-center gap-0.5 bg-white/6 px-1.5 py-0.5 rounded text-[8px] text-offwhite/55 max-w-full">
              <Clock className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{candidate.bestTimeToGo}</span>
            </span>
            <span className="inline-flex items-center gap-0.5 bg-white/6 px-1.5 py-0.5 rounded text-[8px] text-offwhite/55">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate max-w-[5.5rem]">{candidate.estimatedDriveTime}</span>
            </span>
            {sacShort && (
              <span className="inline-flex items-center gap-0.5 bg-orange/15 px-1.5 py-0.5 rounded text-[8px] text-orange">
                <Mountain className="w-2.5 h-2.5 shrink-0" />
                {sacShort}
              </span>
            )}
            {isUsfs && (
              <span className="inline-flex items-center gap-0.5 bg-amber/15 px-1.5 py-0.5 rounded text-[8px] text-amber font-medium">
                <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
                USFS
              </span>
            )}
            {wildernessName && (
              <span className="inline-flex items-center gap-0.5 bg-green/15 px-1.5 py-0.5 rounded text-[8px] text-green font-medium max-w-full truncate">
                <Mountain className="w-2.5 h-2.5 shrink-0" />
                {wildernessName}
              </span>
            )}
          </div>

          {candidate.sceneryHighlights.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {candidate.sceneryHighlights.slice(0, 2).map((h, i) => (
                <span
                  key={i}
                  className="bg-teal/12 text-teal px-1.5 py-0.5 rounded text-[8px] font-medium max-w-full truncate"
                >
                  {h}
                </span>
              ))}
            </div>
          )}

          {validation && (validation.warnings.length > 0 || validation.risks.length > 0) && (
            <div className="space-y-0.5">
              {validation.warnings.slice(0, 1).map((w, i) => (
                <div key={`w-${i}`} className="flex items-start gap-1 text-[9px] text-amber/85 line-clamp-2">
                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
              {validation.risks.slice(0, 1).map((r, i) => (
                <div key={`r-${i}`} className="flex items-start gap-1 text-[9px] text-red/85 line-clamp-2">
                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}

          <div
            className={`mt-auto flex items-center justify-between gap-1 pt-1.5 border-t ${
              isSelected ? 'border-teal/35' : 'border-white/8'
            }`}
          >
            <span className="text-[8px] text-offwhite/30 uppercase tracking-wide font-medium line-clamp-1 flex-1 min-w-0">
              {candidate.weatherForecast}
            </span>
            <div
              className={`flex items-center gap-0.5 text-[10px] font-bold shrink-0 ${
                isSelected ? 'text-teal' : 'text-offwhite/45 group-hover:text-teal'
              }`}
            >
              {isSelected ? 'Selected' : 'View'}
              <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default TrailResultCard;
