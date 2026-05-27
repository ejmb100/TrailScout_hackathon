import type { TrailPoint } from '../services/osmService';

export type LineStringCoordinates = [number, number][];
export type MultiLineStringCoordinates = LineStringCoordinates[];
export type SupportedLineGeometry =
  | { type: 'LineString'; coordinates: LineStringCoordinates }
  | { type: 'MultiLineString'; coordinates: MultiLineStringCoordinates };

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeometryValidationResult {
  valid: boolean;
  issues: string[];
}

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
export const KM_PER_MILE = 1.609344;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

export function haversineKm(a: TrailPoint, b: TrailPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function lineLengthKm(path: TrailPoint[]): number {
  let length = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    length += haversineKm(path[i], path[i + 1]);
  }
  return length;
}

export function distanceMeters(a: TrailPoint, b: TrailPoint): number {
  return haversineKm(a, b) * 1000;
}

export function minDistanceToPathMeters(point: TrailPoint, path: TrailPoint[]): number {
  if (path.length === 0) return Infinity;
  return Math.min(...path.map((pathPoint) => distanceMeters(point, pathPoint)));
}

export function isFinitePoint(point: TrailPoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function coordinateToPoint(coord: unknown): TrailPoint | null {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  const point = { lat, lng };
  return isFinitePoint(point) ? point : null;
}

export function flattenLineGeometry(geometry: unknown): TrailPoint[] {
  const geom = geometry as Partial<SupportedLineGeometry> | null | undefined;
  if (!geom || !geom.type || !Array.isArray(geom.coordinates)) return [];

  if (geom.type === 'LineString') {
    return (geom.coordinates as unknown[]).map(coordinateToPoint).filter((point): point is TrailPoint => point != null);
  }

  if (geom.type === 'MultiLineString') {
    return (geom.coordinates as unknown[])
      .flatMap((line) => (Array.isArray(line) ? line : []))
      .map(coordinateToPoint)
      .filter((point): point is TrailPoint => point != null);
  }

  return [];
}

export function validateLinePath(path: TrailPoint[], label = 'geometry'): GeometryValidationResult {
  const issues: string[] = [];
  if (path.length === 0) issues.push(`${label}: empty geometry`);
  if (path.length === 1) issues.push(`${label}: line has fewer than 2 points`);
  if (path.some((point) => !isFinitePoint(point))) issues.push(`${label}: invalid coordinate`);
  return { valid: issues.length === 0, issues };
}

export function representativePoint(path: TrailPoint[]): TrailPoint | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  const halfLength = lineLengthKm(path) / 2;
  if (halfLength <= 0) return path[Math.floor(path.length / 2)];

  let traveled = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = haversineKm(path[i], path[i + 1]);
    if (traveled + segment >= halfLength) {
      const ratio = segment > 0 ? (halfLength - traveled) / segment : 0;
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * ratio,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * ratio,
      };
    }
    traveled += segment;
  }

  return path[path.length - 1];
}

export function centroid(path: TrailPoint[]): TrailPoint | null {
  if (path.length === 0) return null;
  const sum = path.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / path.length, lng: sum.lng / path.length };
}

export function bboxQueryValue(bbox: BBox): string {
  return `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
}

export function pointInBBox(point: TrailPoint, bbox: BBox): boolean {
  return point.lat >= bbox.south && point.lat <= bbox.north && point.lng >= bbox.west && point.lng <= bbox.east;
}

export function pathIntersectsBBox(path: TrailPoint[], bbox: BBox): boolean {
  return path.some((point) => pointInBBox(point, bbox));
}

export function roundPoint(point: TrailPoint, decimals = 6): TrailPoint {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
  };
}
