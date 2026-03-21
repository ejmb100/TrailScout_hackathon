import React from 'react';
import { motion } from 'motion/react';
import {
  MapPin,
  Clock,
  Mountain,
  TrendingUp,
  Users,
  Star,
  Dog,
  Waves,
  TreePine,
  Eye,
  Droplets,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import type { TrailCandidate, ValidationResult } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import { calculateDistance } from '../utils/trailScoring';

// Trail image URLs (curated Unsplash images for variety)
const trailImages = [
  'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&q=80&w=800&h=450',
  'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&q=80&w=800&h=450',
  'https://images.unsplash.com/photo-1533240332313-0db49b459ad6?auto=format&fit=crop&q=80&w=800&h=450',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&q=80&w=800&h=450',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=800&h=450',
];

interface TrailResultCardProps {
  trail: TrailData;
  candidate: TrailCandidate;
  validation?: ValidationResult;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}

const fitColors: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'bg-green/20', text: 'text-green', label: 'Excellent Fit' },
  good: { bg: 'bg-teal/20', text: 'text-teal', label: 'Good Fit' },
  fair: { bg: 'bg-amber/20', text: 'text-amber', label: 'Fair Fit' },
  poor: { bg: 'bg-red/20', text: 'text-red', label: 'Poor Fit' },
};

const crowdColors: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-green/15', text: 'text-green' },
  moderate: { bg: 'bg-amber/15', text: 'text-amber' },
  high: { bg: 'bg-red/15', text: 'text-red' },
};

const TrailResultCard: React.FC<TrailResultCardProps> = ({
  trail,
  candidate,
  validation,
  rank,
  isSelected,
  onSelect,
}) => {
  const distKm = calculateDistance(trail.path);
  const distMi = (distKm * 0.621371).toFixed(1);
  const imageUrl = trailImages[rank % trailImages.length];
  const fit = validation ? fitColors[validation.overallFit] || fitColors.good : fitColors.good;
  const crowd = crowdColors[candidate.crowdLevel] || crowdColors.moderate;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.15, duration: 0.5 }}
      whileHover={{ y: -4, scale: 1.01 }}
      onClick={onSelect}
      className={`relative group cursor-pointer rounded-3xl overflow-hidden transition-all duration-300 ${
        isSelected
          ? 'ring-2 ring-teal shadow-xl glow-teal'
          : 'ring-1 ring-white/10 hover:ring-white/20 shadow-lg'
      }`}
    >
      {/* Image banner */}
      <div className="relative h-44 overflow-hidden">
        <img
          src={imageUrl}
          alt={trail.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-card via-navy-card/40 to-transparent" />

        {/* Rank badge */}
        <div className="absolute top-4 left-4">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold text-sm ${
            rank === 0 ? 'gradient-orange text-navy' : 'glass text-offwhite'
          }`}>
            #{rank + 1}
          </div>
        </div>

        {/* Match score */}
        <div className="absolute top-4 right-4">
          <div className="glass-bright px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber" />
            <span className="text-xs font-bold text-offwhite">{candidate.matchScore}%</span>
          </div>
        </div>

        {/* Fit badge */}
        {validation && (
          <div className="absolute bottom-4 left-4">
            <div className={`${fit.bg} ${fit.text} px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1`}>
              <ShieldCheck className="w-3 h-3" />
              {fit.label}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 bg-navy-card">
        {/* Trail name & distance */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-display font-bold text-lg text-offwhite leading-tight group-hover:text-teal transition-colors">
            {trail.name || 'Unnamed Trail'}
          </h3>
          <div className="flex-shrink-0 text-right">
            <div className="text-sm font-bold text-teal">{distKm.toFixed(1)} km</div>
            <div className="text-[10px] text-offwhite/40">{distMi} mi</div>
          </div>
        </div>

        {/* Tags row */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="inline-flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg text-[10px] font-medium text-offwhite/60">
            <Clock className="w-3 h-3" /> {candidate.bestTimeToGo}
          </span>
          <span className={`inline-flex items-center gap-1 ${crowd.bg} px-2 py-1 rounded-lg text-[10px] font-medium ${crowd.text}`}>
            <Users className="w-3 h-3" /> {candidate.crowdLevel}
          </span>
          <span className="inline-flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg text-[10px] font-medium text-offwhite/60">
            <MapPin className="w-3 h-3" /> {candidate.estimatedDriveTime}
          </span>
          {trail.tags.sac_scale && (
            <span className="inline-flex items-center gap-1 bg-orange/15 px-2 py-1 rounded-lg text-[10px] font-medium text-orange">
              <TrendingUp className="w-3 h-3" /> {trail.tags.sac_scale.replace(/_/g, ' ')}
            </span>
          )}
          {trail.tags.ele && (
            <span className="inline-flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg text-[10px] font-medium text-offwhite/60">
              <Mountain className="w-3 h-3" /> {trail.tags.ele}m
            </span>
          )}
          {trail.tags.dog && trail.tags.dog !== 'no' && (
            <span className="inline-flex items-center gap-1 bg-green/15 px-2 py-1 rounded-lg text-[10px] font-medium text-green">
              <Dog className="w-3 h-3" /> Dog OK
            </span>
          )}
        </div>

        {/* Scenery highlights */}
        {candidate.sceneryHighlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {candidate.sceneryHighlights.map((h, i) => {
              const icons: Record<string, React.ReactNode> = {
                lake: <Waves className="w-3 h-3" />,
                forest: <TreePine className="w-3 h-3" />,
                mountain: <Mountain className="w-3 h-3" />,
                view: <Eye className="w-3 h-3" />,
                waterfall: <Droplets className="w-3 h-3" />,
              };
              const matchedIcon = Object.entries(icons).find(([k]) => 
                h.toLowerCase().includes(k)
              );
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 bg-teal/10 px-2 py-1 rounded-lg text-[10px] font-medium text-teal"
                >
                  {matchedIcon ? matchedIcon[1] : <Star className="w-3 h-3" />}
                  {h}
                </span>
              );
            })}
          </div>
        )}

        {/* Match explanation */}
        <p className="text-xs text-offwhite/60 leading-relaxed mb-4 border-l-2 border-teal/30 pl-3">
          {candidate.matchExplanation}
        </p>

        {/* Validation checks */}
        {validation && (validation.warnings.length > 0 || validation.risks.length > 0) && (
          <div className="space-y-1.5 mb-4">
            {validation.warnings.map((w, i) => (
              <div key={`w-${i}`} className="flex items-start gap-2 text-[11px] text-amber/80">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{w}</span>
              </div>
            ))}
            {validation.risks.map((r, i) => (
              <div key={`r-${i}`} className="flex items-start gap-2 text-[11px] text-red/80">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className={`flex items-center justify-between pt-3 border-t ${
          isSelected ? 'border-teal/30' : 'border-white/5'
        }`}>
          <span className="text-[10px] text-offwhite/30 uppercase tracking-wider font-medium">
            {candidate.weatherForecast}
          </span>
          <div className={`flex items-center gap-1 text-xs font-semibold transition-colors ${
            isSelected ? 'text-teal' : 'text-offwhite/40 group-hover:text-teal'
          }`}>
            {isSelected ? 'Selected' : 'View Plan'}
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default TrailResultCard;
