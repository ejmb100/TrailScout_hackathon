/**
 * Merge official (USFS) trails with OSM trails, deduplicating by proximity + name.
 * Official geometry wins on match; unmatched trails from both sources are kept.
 */

import type { TrailData, TrailPoint } from './osmService';

function centroid(path: TrailPoint[]): { lat: number; lng: number } {
  let sumLat = 0;
  let sumLng = 0;
  for (const p of path) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  const n = path.length || 1;
  return { lat: sumLat / n, lng: sumLng / n };
}

/** Approximate distance in meters between two geographic points. */
function approxDistM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CENTROID_THRESHOLD_M = 400;
const NAME_SIMILARITY_BOOST = 800;

function namesMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function mergeTrailSources(osmTrails: TrailData[], officialTrails: TrailData[]): TrailData[] {
  if (officialTrails.length === 0) return osmTrails;
  if (osmTrails.length === 0) return officialTrails;

  const osmCentroids = osmTrails.map((t) => ({ trail: t, c: centroid(t.path) }));
  const matchedOsmIds = new Set<number>();

  const merged: TrailData[] = [];

  for (const official of officialTrails) {
    const oc = centroid(official.path);
    let bestOsm: (typeof osmCentroids)[number] | null = null;
    let bestDist = Infinity;

    for (const entry of osmCentroids) {
      if (matchedOsmIds.has(entry.trail.id)) continue;
      const d = approxDistM(oc, entry.c);
      const threshold = namesMatch(official.name, entry.trail.name)
        ? CENTROID_THRESHOLD_M + NAME_SIMILARITY_BOOST
        : CENTROID_THRESHOLD_M;
      if (d < threshold && d < bestDist) {
        bestDist = d;
        bestOsm = entry;
      }
    }

    if (bestOsm) {
      matchedOsmIds.add(bestOsm.trail.id);
      const combinedTags: Record<string, string> = {
        ...bestOsm.trail.tags,
        ...official.tags,
        trailscout_source: `usfs_nfs+${bestOsm.trail.tags.trailscout_source || 'osm'}`,
      };
      merged.push({
        id: official.id,
        name: official.name,
        path: official.path,
        tags: combinedTags,
        elevationGainM: bestOsm.trail.elevationGainM,
        elevationLossM: bestOsm.trail.elevationLossM,
      });
    } else {
      merged.push(official);
    }
  }

  for (const entry of osmCentroids) {
    if (!matchedOsmIds.has(entry.trail.id)) {
      merged.push(entry.trail);
    }
  }

  return merged;
}
