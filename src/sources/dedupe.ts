import { distanceMeters, representativePoint } from '../lib/geo';
import type { DuplicateCandidate, IngestionTrailRecord } from './types';

export const DUPLICATE_CENTROID_THRESHOLD_M = 400;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function namesMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function findDuplicateCandidates(
  primaryRecords: IngestionTrailRecord[],
  contextRecords: IngestionTrailRecord[],
  maxDistanceMeters = DUPLICATE_CENTROID_THRESHOLD_M,
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const primary of primaryRecords) {
    const primaryPoint = representativePoint(primary.geometry);
    if (!primaryPoint) continue;

    for (const context of contextRecords) {
      if (!namesMatch(primary.canonicalName || primary.name, context.canonicalName || context.name)) continue;
      const contextPoint = representativePoint(context.geometry);
      if (!contextPoint) continue;
      const distance = distanceMeters(primaryPoint, contextPoint);
      if (distance > maxDistanceMeters) continue;

      const distanceScore = Math.max(0, 1 - distance / maxDistanceMeters);
      const matchScore = Math.round((0.65 + distanceScore * 0.35) * 100);
      candidates.push({
        primaryId: primary.id,
        duplicateId: context.id,
        primarySourceId: primary.sourceIds[0],
        duplicateSourceId: context.sourceIds[0],
        matchScore,
        centroidDistanceMeters: Math.round(distance),
        explanation: `Name match within ${Math.round(distance)}m; keeping ${primary.sourceName} geometry and linking ${context.sourceName} context.`,
      });
    }
  }

  return candidates.sort((a, b) => b.matchScore - a.matchScore);
}

export function mergeWithDuplicateLinks(
  primaryRecords: IngestionTrailRecord[],
  contextRecords: IngestionTrailRecord[],
): { records: IngestionTrailRecord[]; duplicateCandidates: DuplicateCandidate[]; linkedSourceRecordCount: number } {
  const duplicateCandidates = findDuplicateCandidates(primaryRecords, contextRecords);
  const linkedContextIds = new Set(duplicateCandidates.map((candidate) => candidate.duplicateId));
  const candidatesByPrimary = new Map<string, DuplicateCandidate[]>();

  for (const candidate of duplicateCandidates) {
    const existing = candidatesByPrimary.get(candidate.primaryId) ?? [];
    existing.push(candidate);
    candidatesByPrimary.set(candidate.primaryId, existing);
  }

  const mergedPrimary = primaryRecords.map((record) => {
    const matches = candidatesByPrimary.get(record.id) ?? [];
    if (matches.length === 0) return record;
    const linkedSourceIds = matches.map((match) => match.duplicateId);
    return {
      ...record,
      sourceIds: [...new Set([...record.sourceIds, ...matches.map((match) => match.duplicateSourceId), ...linkedSourceIds])],
      validationIssues: [
        ...record.validationIssues,
        `linked ${matches.length} likely duplicate OSM source record(s); USGS/TNM geometry retained`,
      ],
    };
  });

  const unmatchedContext = contextRecords.filter((record) => !linkedContextIds.has(record.id));
  return {
    records: [...mergedPrimary, ...unmatchedContext],
    duplicateCandidates,
    linkedSourceRecordCount: linkedContextIds.size,
  };
}
