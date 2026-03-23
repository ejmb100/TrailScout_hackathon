/**
 * Multi-day itinerary builder: splits a trail into daily segments
 * ending at the nearest USFS-approved campsite to the target daily distance.
 *
 * Only designated campgrounds and camping areas are used as overnight stops.
 * When no approved site is reachable within a reasonable stretch, the day is
 * flagged as requiring the hiker to verify local dispersed-camping regulations
 * before proceeding.
 */

import type { TrailData, TrailPoint } from '../services/osmService';
import { getCampsitesAlongTrail, trailLengthKm } from '../services/campsiteService';
import type { TrailCampsite } from '../services/campsiteService';

export interface DaySegment {
  day: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  campsite: TrailCampsite | null;
  /** Whether camping at an approved site is confirmed for this night. */
  approvedSite: boolean;
  /** Whether this segment passes through designated wilderness. */
  wilderness: boolean;
  notes: string;
}

export interface MultiDayItinerary {
  totalKm: number;
  days: DaySegment[];
  campsitesFound: number;
  warnings: string[];
  disclaimer: string;
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
  options?: { targetDailyKm?: number }
): MultiDayItinerary {
  const totalKm = trailLengthKm(path);
  const warnings: string[] = [];
  const wildernessName = trail?.tags?.wilderness_name ?? '';

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
    };
  }

  const campsites = getCampsitesAlongTrail(path, { maxOffsetKm: 3.0 });
  const campables = campsites.filter(c => c.siteType === 'campground' || c.siteType === 'camping_area');

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
      days.push({
        day,
        startKm: Math.round(currentKm * 10) / 10,
        endKm: Math.round(totalKm * 10) / 10,
        distanceKm: Math.round((totalKm - currentKm) * 10) / 10,
        campsite: trailheadEnd ?? null,
        approvedSite: true,
        wilderness: isWilderness,
        notes: trailheadEnd
          ? `Finish at ${trailheadEnd.name} trailhead.`
          : 'Finish and exit the trail.',
      });
      break;
    }

    const idealStopKm = currentKm + idealDayKm;
    const windowMin = idealStopKm - idealDayKm * windowFraction;
    const windowMax = Math.min(idealStopKm + idealDayKm * windowFraction, totalKm - 5);

    // Primary: find an approved campsite within the normal window
    let candidates = campables.filter(
      c => c.trailKm >= windowMin && c.trailKm <= windowMax && c.trailKm > currentKm + 3
    );

    // Stretch: if no approved site in window, look further ahead (up to STRETCH_LIMIT_KM)
    if (candidates.length === 0) {
      const stretchMax = Math.min(windowMax + STRETCH_LIMIT_KM, totalKm - 3);
      candidates = campables.filter(
        c => c.trailKm > windowMax && c.trailKm <= stretchMax && c.trailKm > currentKm + 3
      );
      if (candidates.length > 0) {
        warnings.push(`Day ${day}: stretched ${(candidates[0].trailKm - idealStopKm).toFixed(1)} km past ideal to reach ${candidates[0].name}.`);
      }
    }

    let chosen: TrailCampsite | null = null;
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
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

    if (chosen) {
      notes = buildCampsiteNotes(chosen);
      approvedSite = true;
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

    days.push({
      day,
      startKm: Math.round(currentKm * 10) / 10,
      endKm: Math.round(endKm * 10) / 10,
      distanceKm,
      campsite: chosen,
      approvedSite,
      wilderness: isWilderness,
      notes,
    });

    currentKm = endKm;
  }

  return {
    totalKm: Math.round(totalKm * 10) / 10,
    days,
    campsitesFound: days.filter(d => d.campsite !== null).length,
    warnings,
    disclaimer,
  };
}
