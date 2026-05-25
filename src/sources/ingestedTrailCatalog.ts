import type { TrailData } from '../services/osmService';
import { pathIntersectsBBox, type BBox } from '../lib/geo';
import type { IngestionTrailRecord, MergedIngestionOutput } from './types';

export interface IngestedTrailCatalog {
  runId: string;
  label: string;
  records: IngestionTrailRecord[];
  byId: Map<string, IngestionTrailRecord>;
}

export interface IngestedTrailQuery {
  bbox?: BBox;
  text?: string;
  limit?: number;
  includeInvalidGeometry?: boolean;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function recordMatchesText(record: IngestionTrailRecord, text: string): boolean {
  const query = normalizeText(text);
  if (!query) return true;

  const haystack = [
    record.name,
    record.canonicalName,
    ...record.alternateNames,
    record.landManager || '',
    record.managingAgency || '',
    record.sourceName,
  ].map(normalizeText).join(' ');

  return haystack.includes(query);
}

function hasUsableGeometry(record: IngestionTrailRecord): boolean {
  return record.geometry.length >= 2 && !record.validationIssues.some((issue) => /empty geometry|fewer than 2/i.test(issue));
}

function stableNumericId(record: IngestionTrailRecord, index: number): number {
  const digits = record.id.match(/\d+/g)?.join('');
  const parsed = digits ? Number(digits.slice(0, 12)) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 2_000_000_000 + index;
}

export function createIngestedTrailCatalog(output: MergedIngestionOutput): IngestedTrailCatalog {
  return {
    runId: output.meta.runId,
    label: output.meta.label,
    records: output.records,
    byId: new Map(output.records.map((record) => [record.id, record])),
  };
}

export function queryIngestedTrailCatalog(
  catalog: IngestedTrailCatalog,
  query: IngestedTrailQuery = {},
): IngestionTrailRecord[] {
  const limit = query.limit ?? 100;
  const filtered = catalog.records.filter((record) => {
    if (!query.includeInvalidGeometry && !hasUsableGeometry(record)) return false;
    if (query.bbox && !pathIntersectsBBox(record.geometry, query.bbox)) return false;
    if (query.text && !recordMatchesText(record, query.text)) return false;
    return true;
  });

  return filtered.slice(0, limit);
}

export function ingestedRecordToTrailData(record: IngestionTrailRecord, index = 0): TrailData {
  const tags: Record<string, string> = {
    trailscout_source: record.sourceIds.join('+'),
    trailscout_ingested_id: record.id,
    trailscout_source_name: record.sourceName,
    trailscout_confidence: String(record.confidence),
  };

  if (record.lengthMiles != null) tags.length_miles = record.lengthMiles.toFixed(2);
  if (record.landManager) tags.land_manager = record.landManager;
  if (record.managingAgency) tags.managing_agency = record.managingAgency;
  if (record.trailSurface) tags.surface = record.trailSurface;
  if (record.accessStatus) tags.access = record.accessStatus;
  if (record.allowedUses.length > 0) tags.allowed_uses = record.allowedUses.join(';');
  if (record.validationIssues.length > 0) tags.validation_issues = record.validationIssues.join('; ');
  const primaryAttribution = record.sourceAttribution.find((source) => source.primary) ?? record.sourceAttribution[0];
  if (primaryAttribution?.url) tags.source_url = primaryAttribution.url;
  if (record.lastUpdated) tags.last_updated = record.lastUpdated;

  return {
    id: stableNumericId(record, index),
    name: record.canonicalName || record.name,
    path: record.geometry,
    tags,
  };
}

export function queryIngestedTrailData(
  catalog: IngestedTrailCatalog,
  query: IngestedTrailQuery = {},
): TrailData[] {
  return queryIngestedTrailCatalog(catalog, query).map(ingestedRecordToTrailData);
}
