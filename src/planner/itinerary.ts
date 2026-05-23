/**
 * Multi-day itinerary builder: splits a trail into daily segments
 * ending at the nearest public-data-backed camping facility when one exists.
 *
 * Only official campgrounds and camping areas are used as overnight stops.
 * Trailheads and distance-only route progress are never treated as camping
 * recommendations. When no public campsite/campground data supports a stop,
 * the segment gets an explicit unknown/unverified fallback instead.
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

export type CampsiteRecommendationType =
  | 'confirmed_campground'
  | 'official_camping_facility_unverified'
  | 'unknown_unverified';

export type CampsitePermissionStatus = 'confirmed' | 'official_facility_unverified' | 'unknown';
export type CampsiteConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface CampsiteRecommendationMetadata {
  type: CampsiteRecommendationType;
  source: string | null;
  provider: string | null;
  facilityName: string | null;
  distanceFromRouteKm: number | null;
  confidenceLevel: CampsiteConfidenceLevel;
  /** True when a public/bundled source identifies this stop as a camping facility. */
  publicDataBacked: boolean;
  /** True when the source record is an official campground or camping-area facility, not a trailhead or distance-only stop. */
  officialCampingFacility: boolean;
  /** True only when current operational availability is confirmed by an availability/status source such as RIDB. */
  currentAvailabilityConfirmed: boolean;
  /** Back-compat alias for currentAvailabilityConfirmed; do not interpret as merely "official facility exists". */
  permissionConfirmed: boolean;
  permissionStatus: CampsitePermissionStatus;
  status: CampsiteOperationalStatus | 'not_found';
  fallbackReason?: string;
}

export interface DaySegment {
  day: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  /** Effort-adjusted hiking time for this segment (hours), using Tobler's function when elevation data is available. */
  effortHours?: number;
  campsite: TrailCampsite | null;
  /** Whether current overnight availability is confirmed by a status/availability source. */
  approvedSite: boolean;
  /** Public-data-backed metadata for any campsite recommendation or fallback. */
  campsiteRecommendation: CampsiteRecommendationMetadata;
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

/** Max km we'll stretch a day beyond the ideal window to reach a public-data-backed camping facility. */
const STRETCH_LIMIT_KM = 8;

const NO_CONFIRMED_CAMPSITE_MESSAGE =
  'No confirmed legal campsite or campground was found near this segment based on available public data.';

function buildFallbackRecommendation(reason: string): CampsiteRecommendationMetadata {
  return {
    type: 'unknown_unverified',
    source: null,
    provider: null,
    facilityName: null,
    distanceFromRouteKm: null,
    confidenceLevel: 'unknown',
    publicDataBacked: false,
    officialCampingFacility: false,
    currentAvailabilityConfirmed: false,
    permissionConfirmed: false,
    permissionStatus: 'unknown',
    status: 'not_found',
    fallbackReason: reason,
  };
}

function buildCampsiteRecommendation(
  site: TrailCampsite,
  status?: TrailCampsiteStatus,
): CampsiteRecommendationMetadata {
  const currentAvailabilityConfirmed = !!status?.ridbMatch && status.status === 'confirmed';
  const hasRidbWalkIn = !!status?.ridbMatch && status.status === 'walk_in';
  const sources = status?.sources.map(s => s.name).join(' + ') || 'USFS EDW';
  const provider = status?.ridbMatch ? 'Recreation.gov/RIDB + USFS EDW' : 'USFS EDW';
  const permissionStatus: CampsitePermissionStatus = currentAvailabilityConfirmed
    ? 'confirmed'
    : 'official_facility_unverified';

  return {
    type: currentAvailabilityConfirmed ? 'confirmed_campground' : 'official_camping_facility_unverified',
    source: sources,
    provider,
    facilityName: status?.ridbMatch?.name || site.name,
    distanceFromRouteKm: site.offsetKm,
    confidenceLevel: currentAvailabilityConfirmed ? 'high' : hasRidbWalkIn ? 'medium' : 'low',
    publicDataBacked: true,
    officialCampingFacility: true,
    currentAvailabilityConfirmed,
    permissionConfirmed: currentAvailabilityConfirmed,
    permissionStatus,
    status: status?.status ?? 'unverified',
  };
}

function hasOvernightCampingActivity(site: TrailCampsite): boolean {
  if (site.siteType === 'campground') return true;
  const text = site.activities.join(' ').toLowerCase();
  if (!text) return false;
  const hasCamping = /\bcamping\b|overnight|backpacking/.test(text);
  const dayUseOnly = /day use|picnick|interpretive|visitor center/.test(text) && !hasCamping;
  return hasCamping && !dayUseOnly;
}

function isOfficialCampingSite(site: TrailCampsite): boolean {
  if (site.siteType === 'campground') return true;
  if (site.siteType === 'camping_area') return hasOvernightCampingActivity(site);
  return false;
}

const MAX_UNVERIFIED_OVERNIGHT_OFFSET_KM = 1.6;

function isEligibleOvernightSite(site: TrailCampsite, status?: TrailCampsiteStatus): boolean {
  if (!isOfficialCampingSite(site)) return false;
  if (status && isBlocked(status.status)) return false;
  if ((!status || status.status === 'unverified') && site.offsetKm > MAX_UNVERIFIED_OVERNIGHT_OFFSET_KM) return false;
  return true;
}

function recommendationLabel(meta: CampsiteRecommendationMetadata): string {
  switch (meta.type) {
    case 'confirmed_campground': return 'Confirmed campground/campsite';
    case 'official_camping_facility_unverified': return 'Official camping facility (current availability unverified)';
    case 'unknown_unverified': return 'Unknown/unverified camping';
  }
}

function buildCampsiteNotes(site: TrailCampsite, recommendation: CampsiteRecommendationMetadata): string {
  const parts: string[] = [];

  const typeLabel = site.siteType === 'campground' ? 'campground' : 'official camping area';
  parts.push(`${recommendationLabel(recommendation)}: ${site.name} (${typeLabel}).`);
  if (recommendation.provider) parts.push(`Source: ${recommendation.provider}.`);
  if (!recommendation.currentAvailabilityConfirmed && recommendation.officialCampingFacility) {
    parts.push('Official public data identifies this as a camping facility, but current availability must be verified with the managing agency before relying on it.');
  }
  if (recommendation.distanceFromRouteKm != null) parts.push(`~${recommendation.distanceFromRouteKm.toFixed(1)} km from mapped route.`);

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
        campsite: null, approvedSite: false,
        campsiteRecommendation: buildFallbackRecommendation('Single-day itinerary; no overnight campsite is required or recommended.'),
        wilderness: !!wildernessName,
        notes: 'Single day or trail too short for segmenting.',
      }],
      campsitesFound: 0,
      warnings: [],
      disclaimer,
      hasStatusData: false,
    };
  }

  const campsites = getCampsitesAlongTrail(path, { maxOffsetKm: 3.0 });
  const campables = campsites.filter(isOfficialCampingSite);

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

  // Filter out non-camping records and hard-blocked sites (fire, closure).
  // Trailheads remain available only as entry/exit/navigation context, never as overnight stops.
  const eligibleCampables = campables.filter(c => {
    const st = statusMap.get(c.id);
    if (!isEligibleOvernightSite(c, st)) {
      if (st && isBlocked(st.status)) {
        warnings.push(`${c.name}: ${statusLabel(st.status)} — excluded from overnight selection.`);
      }
      return false;
    }
    return true;
  });

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
        campsite: null,
        approvedSite: false,
        campsiteRecommendation: buildFallbackRecommendation('Final trail exit segment; no overnight campsite is required or recommended.'),
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
    let campsiteRecommendation: CampsiteRecommendationMetadata;
    let campsiteStatus: CampsiteOperationalStatus | undefined;
    let campsiteConfidence: number | undefined;
    let campsiteSources: string[] | undefined;

    if (chosen) {
      const st = statusMap.get(chosen.id);
      campsiteRecommendation = buildCampsiteRecommendation(chosen, st);
      notes = buildCampsiteNotes(chosen, campsiteRecommendation);
      approvedSite = campsiteRecommendation.permissionConfirmed;
      if (st) {
        campsiteStatus = st.status;
        campsiteConfidence = st.confidence;
        campsiteSources = st.sources.map(s => s.name);
        if (isConditional(st.status)) {
          notes += ` Status: ${statusLabel(st.status)} — verify current availability before relying on this site.`;
          warnings.push(`Day ${day}: ${chosen.name} is ${statusLabel(st.status).toLowerCase()} — confirm current availability.`);
        }
      } else {
        campsiteSources = [campsiteRecommendation.source ?? 'USFS EDW'];
        notes += ' Operational status is not independently verified; confirm current availability before relying on this site.';
        warnings.push(`Day ${day}: ${chosen.name} appears in official public campsite data, but current operational status is unverified.`);
      }
    } else {
      const fallbackReason = `${NO_CONFIRMED_CAMPSITE_MESSAGE} The planner will not infer camping from route distance or progress.`;
      campsiteRecommendation = buildFallbackRecommendation(fallbackReason);
      notes =
        `${NO_CONFIRMED_CAMPSITE_MESSAGE} ` +
        `Do NOT camp here unless you independently confirm that camping is legal and available with the managing public agency.`;
      approvedSite = false;
      warnings.push(
        `Day ${day}: ${NO_CONFIRMED_CAMPSITE_MESSAGE}`
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
      campsiteRecommendation,
      wilderness: isWilderness,
      notes,
      campsiteStatus,
      campsiteConfidence,
      campsiteSources,
      trailheads: segTrailheads.length > 0 ? segTrailheads : undefined,
    });

    currentKm = endKm;
    if (!chosen) {
      warnings.push(`Partial camp-night coverage: day ${day} uses an unverified distance-based segment endpoint because no source-backed overnight campground was found near that stop window. Later days will still be checked for official camping facilities.`);
    }
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
