/**
 * Multi-day itinerary builder: splits a trail into daily segments
 * ending at the nearest USFS-approved campsite to the target daily distance.
 *
 * Only designated campgrounds and camping areas are used as overnight stops.
 * When no approved site is reachable within a reasonable stretch, the day is
 * flagged as requiring the hiker to verify local dispersed-camping regulations
 * before proceeding.
 *
 * If fused CampsiteStatus data is available, blocked sites (fire closures,
 * facility closures) are excluded from overnight candidate selection.
 */

import type { TrailData, TrailPoint } from '../services/osmService';
import { getCampsitesAlongTrail, trailLengthKm } from '../services/campsiteService';
import type { TrailCampsite } from '../services/campsiteService';
import {
  enrichTrailCampsites,
  isBlocked,
  isConditional,
  statusLabel,
  type CampsiteStatus,
  type CampsiteOperationalStatus,
  type TrailCampsiteStatus,
} from '../services/campsiteStatusService';
import { estimateEffort } from './effort';

export interface DaySegment {
  day: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  /** Effort-adjusted hiking time for this segment (hours), using Tobler's function when elevation data is available. */
  effortHours?: number;
  campsite: TrailCampsite | null;
  /** Whether camping at an approved site is confirmed for this night. */
  approvedSite: boolean;
  /** Whether this segment passes through designated wilderness. */
  wilderness: boolean;
  notes: string;
  /** Operational status from multi-source fusion (when available). */
  campsiteStatus?: CampsiteOperationalStatus;
  /** Confidence score (0–100) from the fusion layer. */
  campsiteConfidence?: number;
  /** Data sources that contributed to this campsite's status. */
  campsiteSources?: string[];
  /** Named trailheads traversed during this segment. */
  trailheads?: { name: string; km: number }[];
}

export interface MultiDayItinerary {
  totalKm: number;
  days: DaySegment[];
  campsitesFound: number;
  warnings: string[];
  disclaimer: string;
  /** True when multi-source fusion data was used. */
  hasStatusData: boolean;
  /** Entry trailhead (nearest to km 0, if found). */
  entryTrailhead?: { name: string; km: number };
  /** Exit trailhead (nearest to trail end, if found). */
  exitTrailhead?: { name: string; km: number };
}

/** Max km we'll stretch a day beyond the ideal window to reach an approved site. */
const STRETCH_LIMIT_KM = 8;

function buildCampsiteNotes(site: TrailCampsite): string {
  const parts: string[] = [];

  const typeLabel = site.siteType === 'campground' ? 'campground' : 'designated dispersed area';
  parts.push(`Camp at ${site.name} (${typeLabel}).`);

  if (site.water === true) parts.push('Water available.');
  else if (site.water === false) parts.push('No water — carry enough.');
  else parts.push('Water status unknown — carry backup.');

  if (site.fee) parts.push('Fee site.');
  if (site.openSeason) parts.push(`Season: ${site.openSeason} — verify before trip.`);
  if (site.restrictions) parts.push(site.restrictions);

  return parts.join(' ');
}

export function buildMultiDayItinerary(
  path: TrailPoint[],
  tripDays: number,
  trail?: TrailData,
  options?: { targetDailyKm?: number; campsiteStatuses?: CampsiteStatus[] }
): MultiDayItinerary {
  const totalKm = trailLengthKm(path);
  const warnings: string[] = [];
  const wildernessName = trail?.tags?.wilderness_name ?? '';
  const hasStatusData = (options?.campsiteStatuses ?? []).length > 0;

  const disclaimer =
    'This itinerary is generated from USFS data and is not a permit or reservation. ' +
    'Verify campsite availability, seasonal closures, fire restrictions, and permit requirements ' +
    'with the local ranger district before your trip. Conditions change — do not rely solely on this plan.';

  if (totalKm < 2 || tripDays < 2) {
    return {
      totalKm,
      days: [{
        day: 1, startKm: 0, endKm: totalKm, distanceKm: totalKm,
        campsite: null, approvedSite: false, wilderness: !!wildernessName,
        notes: 'Single day or trail too short for segmenting.',
      }],
      campsitesFound: 0,
      warnings: [],
      disclaimer,
      hasStatusData: false,
    };
  }

  const campsites = getCampsitesAlongTrail(path, { maxOffsetKm: 3.0 });
  const campables = campsites.filter(c => c.siteType === 'campground' || c.siteType === 'camping_area');

  // Identify trailheads along the route
  const allTrailheads = campsites
    .filter(c => c.siteType === 'trailhead')
    .sort((a, b) => a.trailKm - b.trailKm);
  const entryTrailhead = allTrailheads.find(t => t.trailKm <= 2)
    ? { name: allTrailheads.find(t => t.trailKm <= 2)!.name, km: Math.round(allTrailheads.find(t => t.trailKm <= 2)!.trailKm * 10) / 10 }
    : undefined;
  const exitTrailhead = allTrailheads.find(t => t.trailKm >= totalKm - 2)
    ? { name: allTrailheads.find(t => t.trailKm >= totalKm - 2)!.name, km: Math.round(allTrailheads.find(t => t.trailKm >= totalKm - 2)!.trailKm * 10) / 10 }
    : undefined;

  // Enrich with fused status when available
  const statusMap = new Map<number, TrailCampsiteStatus>();
  if (hasStatusData) {
    const enriched = enrichTrailCampsites(campables, options!.campsiteStatuses!);
    for (const s of enriched) statusMap.set(s.campsite.id, s);
  }

  // Filter out hard-blocked sites (fire, closure)
  const eligibleCampables = hasStatusData
    ? campables.filter(c => {
        const st = statusMap.get(c.id);
        if (st && isBlocked(st.status)) {
          warnings.push(`${c.name}: ${statusLabel(st.status)} — excluded from overnight selection.`);
          return false;
        }
        return true;
      })
    : campables;

  // Compute total effort for proportional distribution across day segments
  const effortEst = trail ? estimateEffort(trail) : null;
  const totalEffortH = effortEst ? effortEst.adjustedTimeHours : null;

  const targetDailyKm = options?.targetDailyKm ?? totalKm / tripDays;
  const windowFraction = 0.35;

  if (wildernessName) {
    warnings.push(
      `Trail passes through ${wildernessName}. Group size limits, fire restrictions, and permit requirements may apply. ` +
      `No mechanized travel or bicycles. Check with the local ranger district.`
    );
  }

  const days: DaySegment[] = [];
  let currentKm = 0;

  for (let day = 1; day <= tripDays; day++) {
    const isLastDay = day === tripDays;
    const remainingKm = totalKm - currentKm;
    const remainingDays = tripDays - day + 1;
    const idealDayKm = remainingKm / remainingDays;
    const isWilderness = !!wildernessName;

    if (isLastDay) {
      const trailheadEnd = campsites.find(
        c => c.siteType === 'trailhead' && c.trailKm >= totalKm - 2
      );
      const segDist = Math.round((totalKm - currentKm) * 10) / 10;
      const lastDayTrailheads = allTrailheads
        .filter(t => t.trailKm >= currentKm && t.trailKm <= totalKm)
        .map(t => ({ name: t.name, km: Math.round(t.trailKm * 10) / 10 }));
      const lastNotes = trailheadEnd
        ? `Finish at ${trailheadEnd.name} trailhead.`
        : 'Finish and exit the trail.';
      days.push({
        day,
        startKm: Math.round(currentKm * 10) / 10,
        endKm: Math.round(totalKm * 10) / 10,
        distanceKm: segDist,
        effortHours: totalEffortH != null && totalKm > 0
          ? Math.round((segDist / totalKm) * totalEffortH * 10) / 10
          : undefined,
        campsite: trailheadEnd ?? null,
        approvedSite: true,
        wilderness: isWilderness,
        notes: lastNotes,
        trailheads: lastDayTrailheads.length > 0 ? lastDayTrailheads : undefined,
      });
      break;
    }

    const idealStopKm = currentKm + idealDayKm;
    const windowMin = idealStopKm - idealDayKm * windowFraction;
    const windowMax = Math.min(idealStopKm + idealDayKm * windowFraction, totalKm - 5);

    let candidates = eligibleCampables.filter(
      c => c.trailKm >= windowMin && c.trailKm <= windowMax && c.trailKm > currentKm + 3
    );

    if (candidates.length === 0) {
      const stretchMax = Math.min(windowMax + STRETCH_LIMIT_KM, totalKm - 3);
      candidates = eligibleCampables.filter(
        c => c.trailKm > windowMax && c.trailKm <= stretchMax && c.trailKm > currentKm + 3
      );
      if (candidates.length > 0) {
        warnings.push(`Day ${day}: stretched ${(candidates[0].trailKm - idealStopKm).toFixed(1)} km past ideal to reach ${candidates[0].name}.`);
      }
    }

    let chosen: TrailCampsite | null = null;
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        // When status data is available, prefer confirmed > walk_in > unverified
        if (hasStatusData) {
          const sa = statusMap.get(a.id);
          const sb = statusMap.get(b.id);
          const rank = (s?: TrailCampsiteStatus) =>
            !s ? 3 : s.status === 'confirmed' ? 0 : s.status === 'walk_in' ? 1 : 2;
          const sr = rank(sa) - rank(sb);
          if (sr !== 0) return sr;
        }
        const typePriority = (c: TrailCampsite) => c.siteType === 'campground' ? 0 : 1;
        const tp = typePriority(a) - typePriority(b);
        if (tp !== 0) return tp;
        if (a.water && !b.water) return -1;
        if (!a.water && b.water) return 1;
        return Math.abs(a.trailKm - idealStopKm) - Math.abs(b.trailKm - idealStopKm);
      });
      chosen = candidates[0];
    }

    const endKm = chosen ? chosen.trailKm : idealStopKm;
    const distanceKm = Math.round((endKm - currentKm) * 10) / 10;

    let notes: string;
    let approvedSite: boolean;
    let campsiteStatus: CampsiteOperationalStatus | undefined;
    let campsiteConfidence: number | undefined;
    let campsiteSources: string[] | undefined;

    if (chosen) {
      notes = buildCampsiteNotes(chosen);
      approvedSite = true;
      const st = statusMap.get(chosen.id);
      if (st) {
        campsiteStatus = st.status;
        campsiteConfidence = st.confidence;
        campsiteSources = st.sources.map(s => s.name);
        if (isConditional(st.status)) {
          notes += ` Status: ${statusLabel(st.status)} — verify before relying on this site.`;
          warnings.push(`Day ${day}: ${chosen.name} is ${statusLabel(st.status).toLowerCase()} — confirm availability.`);
        }
      }
    } else {
      notes =
        `No USFS-approved campsite found within range of km ${endKm.toFixed(1)}. ` +
        `Do NOT camp here without first confirming that dispersed camping is permitted at this location. ` +
        `Check with the local ranger district for closures, fire bans, and camping regulations.`;
      approvedSite = false;
      warnings.push(
        `Day ${day}: no approved campsite reachable. You must verify dispersed camping is allowed before overnighting here.`
      );
    }

    if (isWilderness && !isLastDay) {
      notes += ' Wilderness area: group size limits and fire restrictions apply.';
    }

    // Identify trailheads traversed during this segment
    const segTrailheads = allTrailheads
      .filter(t => t.trailKm >= currentKm && t.trailKm <= endKm)
      .map(t => ({ name: t.name, km: Math.round(t.trailKm * 10) / 10 }));
    if (segTrailheads.length > 0 && day === 1 && entryTrailhead) {
      notes = `Start at ${entryTrailhead.name} trailhead. ${notes}`;
    } else if (segTrailheads.length > 0) {
      const thNames = segTrailheads.map(t => `${t.name} (km ${t.km})`).join(', ');
      notes += ` Passes trailhead(s): ${thNames}.`;
    }

    days.push({
      day,
      startKm: Math.round(currentKm * 10) / 10,
      endKm: Math.round(endKm * 10) / 10,
      distanceKm,
      effortHours: totalEffortH != null && totalKm > 0
        ? Math.round((distanceKm / totalKm) * totalEffortH * 10) / 10
        : undefined,
      campsite: chosen,
      approvedSite,
      wilderness: isWilderness,
      notes,
      campsiteStatus,
      campsiteConfidence,
      campsiteSources,
      trailheads: segTrailheads.length > 0 ? segTrailheads : undefined,
    });

    currentKm = endKm;
  }

  return {
    totalKm: Math.round(totalKm * 10) / 10,
    days,
    campsitesFound: days.filter(d => d.campsite !== null).length,
    warnings,
    disclaimer,
    hasStatusData,
    entryTrailhead,
    exitTrailhead,
  };
}
