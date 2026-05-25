import type { SourceAttribution } from '../types/trailscout';
import type { TrailPoint } from '../services/osmService';
import {
  flattenLineGeometry,
  kmToMiles,
  lineLengthKm,
  roundPoint,
  type BBox,
} from '../lib/geo';
import { getSourceById } from './registry';
import type { IngestionTrailRecord } from './types';

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role?: string }[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function sourceAttribution(): SourceAttribution {
  const source = getSourceById('osm-overpass');
  return {
    sourceId: source.id,
    name: source.name,
    kind: 'open_public',
    primary: true,
    url: 'https://www.openstreetmap.org/copyright',
    confidence: 70,
    warnings: ['OpenStreetMap is community-maintained and may be incomplete or out of date.'],
  };
}

function safeString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function buildTrailName(tags: Record<string, string>, fallback: string): { name: string; issues: string[] } {
  const name = safeString(tags.name);
  const ref = safeString(tags.ref);
  if (name) return { name, issues: [] };
  if (ref) return { name: ref, issues: [] };
  return { name: fallback, issues: ['missing trail name'] };
}

function allowedUsesFromTags(tags: Record<string, string>): string[] {
  const uses = new Set<string>();
  if (/path|footway|track/i.test(tags.highway || '') || tags.route === 'hiking' || tags.foot !== 'no') uses.add('hiking');
  if (tags.bicycle && tags.bicycle !== 'no') uses.add('bicycle');
  if (tags.horse && tags.horse !== 'no') uses.add('horse');
  if (tags.ski && tags.ski !== 'no') uses.add('ski');
  return [...uses];
}

function recordFromPath(
  sourceRecordId: string,
  tags: Record<string, string>,
  path: TrailPoint[],
  originalGeometry: unknown,
  sourceKind: 'osm_way' | 'osm_relation',
): IngestionTrailRecord {
  const roundedPath = path.map((point) => roundPoint(point));
  const fallback = sourceKind === 'osm_relation' ? `OSM hiking route ${sourceRecordId}` : `OSM trail segment ${sourceRecordId}`;
  const { name, issues } = buildTrailName(tags, fallback);
  const geometryIssues = roundedPath.length === 0
    ? ['empty geometry']
    : roundedPath.length === 1
      ? ['line geometry has fewer than 2 points']
      : [];
  const validationIssues = [...issues, ...geometryIssues];
  const distanceKm = lineLengthKm(roundedPath);
  const allowedUses = allowedUsesFromTags(tags);
  const sourceIds = ['osm-overpass', `${sourceKind}:${sourceRecordId}`];

  return {
    id: `osm:${sourceKind}:${sourceRecordId}`,
    sourceRecordId,
    sourceIds,
    sourceName: 'OpenStreetMap via Overpass',
    name,
    canonicalName: name,
    alternateNames: [safeString(tags.alt_name), safeString(tags.old_name)].filter(Boolean),
    geometry: roundedPath,
    originalGeometry,
    geometryType: 'LineString',
    distanceKm,
    lengthMiles: kmToMiles(distanceKm),
    routeType: tags.route === 'hiking' ? 'unknown' : 'unknown',
    surface: tags.surface,
    trailSurface: tags.surface,
    permittedUses: allowedUses,
    allowedUses,
    difficultySignals: [safeString(tags.sac_scale), safeString(tags.trail_visibility)].filter(Boolean),
    managingAgency: tags.operator,
    landManager: tags.operator,
    accessStatus: tags.access,
    sourceConfidence: sourceKind === 'osm_relation' ? 72 : 58,
    confidence: validationIssues.length === 0 ? (sourceKind === 'osm_relation' ? 72 : 58) : 40,
    confidenceFields: {
      geometry: roundedPath.length >= 2 ? 70 : 20,
      naming: issues.length === 0 ? 75 : 30,
      sourceAuthority: 55,
    },
    sourceAttribution: [sourceAttribution()],
    validationIssues,
    rawProperties: tags,
  };
}

function concatSegments(segments: TrailPoint[][]): TrailPoint[] {
  const path: TrailPoint[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (path.length === 0) {
      path.push(...segment);
      continue;
    }
    const first = segment[0];
    const last = path[path.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) {
      path.push(...segment.slice(1));
    } else {
      path.push(...segment);
    }
  }
  return path;
}

export function buildOverpassTrailsQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  return `
    [out:json][timeout:45];
    (
      way["highway"~"path|footway|track"]["name"](${south},${west},${north},${east});
      way["highway"~"path|footway|track"]["ref"](${south},${west},${north},${east});
      way["highway"~"path|footway|track"]["sac_scale"](${south},${west},${north},${east});
      relation["route"="hiking"](${south},${west},${north},${east});
    );
    out body qt;
    >;
    out skel qt;
  `;
}

export function buildOverpassRequestBody(bbox: BBox): string {
  return `data=${encodeURIComponent(buildOverpassTrailsQuery(bbox))}`;
}

export function normalizeOverpassResponse(data: unknown): IngestionTrailRecord[] {
  const response = data as OverpassResponse;
  const elements = Array.isArray(response.elements) ? response.elements : [];
  const nodes = new Map<number, TrailPoint>();
  for (const element of elements) {
    if (element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
      nodes.set(element.id, { lat: Number(element.lat), lng: Number(element.lon) });
    }
  }

  const wayPaths = new Map<number, TrailPoint[]>();
  const waysById = new Map<number, OverpassElement>();
  for (const element of elements) {
    if (element.type !== 'way') continue;
    waysById.set(element.id, element);
    const path = (element.nodes ?? []).map((nodeId) => nodes.get(nodeId)).filter((point): point is TrailPoint => point != null);
    wayPaths.set(element.id, path);
  }

  const records: IngestionTrailRecord[] = [];
  const usedWayIds = new Set<number>();

  for (const element of elements) {
    if (element.type !== 'relation' || element.tags?.route !== 'hiking') continue;
    const segments: TrailPoint[][] = [];
    for (const member of element.members ?? []) {
      if (member.type !== 'way') continue;
      let path = wayPaths.get(member.ref) ?? [];
      if (member.role?.toLowerCase().includes('backward')) path = [...path].reverse();
      segments.push(path);
      usedWayIds.add(member.ref);
    }
    const path = concatSegments(segments);
    const originalGeometry = { type: 'LineString', coordinates: path.map((point) => [point.lng, point.lat]) };
    records.push(recordFromPath(String(element.id), element.tags ?? {}, path, originalGeometry, 'osm_relation'));
  }

  for (const element of elements) {
    if (element.type !== 'way' || usedWayIds.has(element.id)) continue;
    const tags = element.tags ?? {};
    if (!/path|footway|track/i.test(tags.highway || '')) continue;
    const path = wayPaths.get(element.id) ?? [];
    const originalGeometry = { type: 'LineString', coordinates: path.map((point) => [point.lng, point.lat]) };
    records.push(recordFromPath(String(element.id), tags, path, originalGeometry, 'osm_way'));
  }

  return records;
}

export function normalizeOsmGeoJsonFeatureLike(
  sourceRecordId: string,
  tags: Record<string, string>,
  geometry: unknown,
): IngestionTrailRecord {
  return recordFromPath(sourceRecordId, tags, flattenLineGeometry(geometry), geometry, 'osm_way');
}
