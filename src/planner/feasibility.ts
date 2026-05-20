import type { IntentProfile } from '../services/geminiService';
import type { TrailData } from '../services/osmService';
import type { TrailFeasibilityResult } from './types';
import { effectiveTrailDistanceKm } from '../utils/trailScoring';
import { effortTimeHours } from './effort';

function isRelationTrail(tags: Record<string, string>): boolean {
  return tags.trailscout_source === 'osm_relation';
}

function isSegmentTrail(tags: Record<string, string>): boolean {
  return tags.trailscout_source === 'osm_way_segment';
}

function isOfficialTrailSource(tags: Record<string, string>): boolean {
  const source = tags.trailscout_source ?? '';
  return source.includes('usfs_nfs') || source === 'cotrex' || source === 'assembled_route';
}

/** Parse "14:00", "2:00 PM", "2pm" → minutes from midnight, or null */
export function parseReturnTimeMinutes(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const m24 = t.match(/^(\d{1,2}):(\d{2})\s*$/);
  if (m24) {
    const h = Number(m24[1]);
    const min = Number(m24[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
  }
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/);
  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2] ? Number(m12[2]) : 0;
    const ap = m12[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
  }
  return null;
}

/** Crude: assume ~45 min one-way drive if we cannot parse tolerance */
function defaultDriveMinutes(_intent: IntentProfile): number {
  return 45;
}

/**
 * Geometry-backed feasibility: mapped OSM length vs intent distance targets,
 * segment vs relation policy, optional return-time sanity check.
 */
export function assessFeasibility(intent: IntentProfile, trail: TrailData): TrailFeasibilityResult {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const path = trail.path;
  const distKm = path.length >= 2 ? effectiveTrailDistanceKm(trail) : 0;

  const targetKm =
    intent.tripType === 'multi_day'
      ? Math.max(intent.searchDistanceKm, intent.dailyDistanceKm * intent.tripLengthDays, 24)
      : Math.max(intent.maxDistanceKm, 0.5);

  const ratio = targetKm > 0 ? distKm / targetKm : 0;
  const relation = isRelationTrail(trail.tags);
  const segment = isSegmentTrail(trail.tags);

  const usfs = isOfficialTrailSource(trail.tags);

  const stitched = trail.tags.trailscout_source === 'usfs_nfs_stitched';
  let geometryNote = 'Mapped OSM geometry length is used; it may be a segment, loop, or full route.';
  if (stitched) {
    geometryNote = `USFS stitched trail (${trail.tags.usfs_segment_count ?? '?'} segments joined) — geometry from official USDA data.`;
  } else if (trail.tags.trailscout_source === 'assembled_route') {
    geometryNote = `TrailScout assembled route (${trail.tags.assembled_segment_count ?? '?'} connected segments from ${trail.tags.assembled_sources ?? 'public trail sources'}) — verify exact routing before navigation.`;
  } else if (trail.tags.trailscout_source === 'cotrex') {
    geometryNote = 'COTREX trail — geometry and length from Colorado Trail Explorer public data.';
  } else if (usfs) {
    geometryNote = 'USFS National Forest System trail — geometry from official USDA data.';
  } else if (relation) {
    geometryNote = 'Full OSM route relation — length is usually closer to a complete trail.';
  } else if (segment) {
    geometryNote = 'OSM way segment — length may be only part of a longer named trail; verify on the ground.';
  }

  if (distKm <= 0 || path.length < 2) {
    blockingReasons.push('Trail has insufficient geometry to estimate length safely.');
    return { eligible: false, blockingReasons, warnings, geometryNote };
  }

  const isMultiDay = intent.tripType === 'multi_day';
  const minRatio = isMultiDay
    ? (usfs ? 0.55 : segment ? 0.50 : 0.42)
    : (usfs ? 0.25 : segment ? 0.42 : 0.32);
  const maxRatio = usfs ? 1.8 : segment ? 1.28 : 1.5;

  console.info(`[Feasibility] "${trail.name}" → ${distKm.toFixed(1)} km, target=${targetKm.toFixed(1)} km, ratio=${ratio.toFixed(2)}, tripType=${intent.tripType}, isMultiDay=${isMultiDay}, source=${trail.tags.trailscout_source ?? 'osm'}`);

  if (isMultiDay && distKm < 12) {
    blockingReasons.push(
      `Trail geometry (${distKm.toFixed(1)} km) is too short for a multi-day trip. Look for a route or stitched trail system >= 12 km.`
    );
  } else if (!isMultiDay && ratio < 0.22) {
    blockingReasons.push(
      `Mapped trail (${distKm.toFixed(1)} km) is far shorter than your target day hike (~${targetKm.toFixed(1)} km).`
    );
  } else if (ratio < minRatio) {
    blockingReasons.push(
      `Mapped trail (${distKm.toFixed(1)} km) is likely too short for this request (target ~${targetKm.toFixed(1)} km).`
    );
  }

  if (intent.tripType === 'day_hike' && ratio > 1.65) {
    blockingReasons.push(
      `Mapped trail (${distKm.toFixed(1)} km) is much longer than your target (~${targetKm.toFixed(1)} km) for a day hike.`
    );
  } else if (ratio > maxRatio + 0.15) {
    warnings.push(
      `Mapped trail (${distKm.toFixed(1)} km) is substantially longer than your distance target (~${targetKm.toFixed(1)} km).`
    );
  } else if (ratio > maxRatio) {
    warnings.push(
      `Mapped trail (${distKm.toFixed(1)} km) exceeds your target (~${targetKm.toFixed(1)} km); confirm you want a longer outing.`
    );
  }

  const returnMin = parseReturnTimeMinutes(intent.latestReturnTime);
  if (returnMin != null && intent.tripType === 'day_hike') {
    const startMin = 7 * 60;
    const driveMin = defaultDriveMinutes(intent);
    const hikeHours = effortTimeHours(trail, intent.difficulty);
    const hikeMin = hikeHours * 60;
    const homeByMin = startMin + driveMin * 2 + hikeMin;
    if (homeByMin > returnMin + 30) {
      blockingReasons.push(
        `Rough timing (start 7:00, ~${driveMin} min drive each way, ~${hikeHours.toFixed(1)} h hiking incl. terrain) suggests you may miss your "${intent.latestReturnTime}" return constraint.`
      );
    }
  }

  const eligible = blockingReasons.length === 0;
  return { eligible, blockingReasons, warnings, geometryNote };
}
