import type { TrailData, TrailPoint } from './osmService';

export interface RouteBuilderOptions {
  targetKm: number;
  maxCandidates?: number;
  maxEndpointGapKm?: number;
}

const DEFAULT_MAX_ENDPOINT_GAP_KM = 1.0;
const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
const ASSEMBLED_ID_BASE = -7_000_000;

function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path: TrailPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += haversineKm(path[i], path[i + 1]);
  return total;
}

function trailLengthKm(trail: TrailData): number {
  const tagged = Number(trail.tags.trailscout_length_km);
  const geometry = pathLengthKm(trail.path);
  return Number.isFinite(tagged) && tagged > 0 ? Math.max(tagged, geometry) : geometry;
}

function cleanRouteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bsegments?\s*\d+[a-z]?\b/g, ' ')
    .replace(/\bsection\s*\d+[a-z]?\b/g, ' ')
    .replace(/\bseg\.?\s*\d+[a-z]?\b/g, ' ')
    .replace(/\b\d+[a-z]?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function knownLongTrailFamily(name: string): string | null {
  const lower = name.toLowerCase();
  const knownFamilies = [
    { key: 'colorado trail', pattern: /\bcolorado\s+trail\b/ },
    { key: 'continental divide trail', pattern: /\bcontinental\s+divide\s+trail\b|\bcdt\b/ },
    { key: 'collegiate loop', pattern: /\bcollegiate\s+loop\b/ },
  ];
  return knownFamilies.find((family) => family.pattern.test(lower))?.key ?? null;
}

function routeKey(trail: TrailData): string | null {
  const knownFamily = knownLongTrailFamily(trail.name);
  if (knownFamily) return `long-trail:${knownFamily}`;

  const ref = trail.tags.trail_num || trail.tags.trail_num_ || trail.tags.trail_num1 || trail.tags.ref || trail.tags.usfs_trail_no;
  const source = trail.tags.trailscout_source ?? 'unknown';
  if (ref) return `${source}:ref:${ref.toLowerCase().trim()}`;

  const cleaned = cleanRouteName(trail.name);
  if (!cleaned || cleaned.length < 5) return null;

  // Keep the route family broad enough for names such as "Colorado Trail Segment 14"
  // while avoiding accidental joins of unrelated short spurs.
  return `name:${cleaned}`;
}

function endpoints(path: TrailPoint[]): { start: TrailPoint; end: TrailPoint } | null {
  if (path.length < 2) return null;
  return { start: path[0], end: path[path.length - 1] };
}

function appendPath(base: TrailPoint[], next: TrailPoint[], snapGapKm: number): TrailPoint[] {
  if (base.length === 0) return [...next];
  if (next.length === 0) return [...base];
  const tail = base[base.length - 1];
  const head = next[0];
  const skipHead = haversineKm(tail, head) <= snapGapKm;
  return skipHead ? [...base, ...next.slice(1)] : [...base, ...next];
}

function chainGroup(group: TrailData[], maxGapKm: number): TrailData[] {
  if (group.length < 2) return group;

  let bestChain: TrailData[] = [];

  for (const seed of group) {
    const remaining = group.filter((trail) => trail.id !== seed.id);
    const chain: TrailData[] = [seed];

    let extended = true;
    while (extended && remaining.length > 0) {
      extended = false;
      const currentEnd = endpoints(chain[chain.length - 1].path)?.end;
      if (!currentEnd) break;

      let bestIndex = -1;
      let bestDistance = Infinity;
      let reverse = false;

      for (let i = 0; i < remaining.length; i++) {
        const e = endpoints(remaining[i].path);
        if (!e) continue;
        const startDist = haversineKm(currentEnd, e.start);
        const endDist = haversineKm(currentEnd, e.end);
        if (startDist < bestDistance) {
          bestDistance = startDist;
          bestIndex = i;
          reverse = false;
        }
        if (endDist < bestDistance) {
          bestDistance = endDist;
          bestIndex = i;
          reverse = true;
        }
      }

      if (bestIndex >= 0 && bestDistance <= maxGapKm) {
        const [next] = remaining.splice(bestIndex, 1);
        chain.push(reverse ? { ...next, path: [...next.path].reverse() } : next);
        extended = true;
      }
    }

    if (chain.length > bestChain.length) bestChain = chain;
  }

  return bestChain;
}

function assembledName(chain: TrailData[]): string {
  const knownFamily = knownLongTrailFamily(chain[0].name);
  if (knownFamily) {
    return `${knownFamily
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')} assembled route`;
  }

  const base = cleanRouteName(chain[0].name)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return `${base || 'Trail'} assembled route`;
}

export function buildMultiDayRouteCandidates(
  trails: TrailData[],
  options: RouteBuilderOptions,
): TrailData[] {
  const maxCandidates = options.maxCandidates ?? 8;
  const maxGapKm = options.maxEndpointGapKm ?? DEFAULT_MAX_ENDPOINT_GAP_KM;
  const targetKm = Math.max(options.targetKm, 1);
  const groups = new Map<string, TrailData[]>();

  for (const trail of trails) {
    if (!trail.path || trail.path.length < 2) continue;
    const key = routeKey(trail);
    if (!key) continue;
    const source = trail.tags.trailscout_source ?? '';
    if (!/(cotrex|usfs|osm|assembled)/i.test(source)) continue;
    const existing = groups.get(key) ?? [];
    existing.push(trail);
    groups.set(key, existing);
  }

  const candidates: { trail: TrailData; lengthKm: number; score: number }[] = [];
  let ordinal = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const chain = chainGroup(group, maxGapKm);
    if (chain.length < 2) continue;

    const lengthKm = chain.reduce((sum, trail) => sum + trailLengthKm(trail), 0);
    if (lengthKm < Math.max(24, targetKm * 0.45)) continue;

    const path = chain.reduce<TrailPoint[]>((acc, trail) => appendPath(acc, trail.path, maxGapKm), []);
    const sources = [...new Set(chain.map((trail) => trail.tags.trailscout_source || 'unknown'))].sort();
    const sourceIds = chain.map((trail) => String(trail.id)).join(',');
    const trail: TrailData = {
      id: ASSEMBLED_ID_BASE - ordinal,
      name: assembledName(chain),
      path,
      tags: {
        trailscout_source: 'assembled_route',
        trailscout_length_km: lengthKm.toFixed(1),
        assembled_segment_count: String(chain.length),
        assembled_sources: sources.join('+'),
        assembled_source_ids: sourceIds,
        source: `TrailScout route builder (${sources.join(' + ')})`,
      },
    };
    ordinal++;

    const ratio = lengthKm / targetKm;
    const distanceScore = Math.abs(1 - ratio);
    const segmentBonus = Math.min(chain.length, 8) * 0.02;
    candidates.push({ trail, lengthKm, score: distanceScore - segmentBonus });
  }

  return candidates
    .sort((a, b) => a.score - b.score || b.lengthKm - a.lengthKm)
    .slice(0, maxCandidates)
    .map((candidate) => candidate.trail);
}
