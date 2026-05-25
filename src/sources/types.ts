import type { NormalizedTrail } from '../types/trailscout';
import type { BBox } from '../lib/geo';

export type SourceCategory =
  | 'official_public'
  | 'open_public'
  | 'federal_public'
  | 'state_public'
  | 'weather_public'
  | 'planned_public';

export type CommercialUseStatus = 'allowed_with_terms' | 'requires_review' | 'unknown' | 'not_ingestible';
export type CacheStatus = 'cache_allowed' | 'cache_with_terms' | 'do_not_cache' | 'unknown';
export type RedistributionStatus = 'redistribution_allowed' | 'share_alike_required' | 'restricted' | 'unknown';

export interface SourceRegistryEntry {
  id: string;
  name: string;
  category: SourceCategory;
  endpoint: string;
  licenseOrTerms: string;
  attributionRequirement: string;
  commercialUseStatus: CommercialUseStatus;
  cachingStatus: CacheStatus;
  redistributionStatus: RedistributionStatus;
  updateFrequency: string;
  notes: string;
  ingestible: boolean;
}

export interface IngestionRunMeta {
  runId: string;
  label: string;
  sourceId: string;
  sourceName: string;
  fetchedAt: string;
  bbox: BBox;
  endpoint: string;
  featureCount: number;
  normalizedCount: number;
  validationIssueCount: number;
}

export interface IngestionOutput<T = IngestionTrailRecord> {
  meta: IngestionRunMeta;
  records: T[];
}

export interface IngestionTrailRecord extends NormalizedTrail {
  sourceRecordId: string;
  sourceName: string;
  canonicalName: string;
  alternateNames: string[];
  originalGeometry: unknown;
  geometryType: 'LineString' | 'MultiLineString' | 'Unknown';
  lengthMiles?: number;
  allowedUses: string[];
  landManager?: string;
  state?: string;
  county?: string;
  accessStatus?: string;
  trailSurface?: string;
  confidence: number;
  confidenceFields: Record<string, number>;
  validationIssues: string[];
  rawProperties: Record<string, unknown>;
}

export interface DuplicateCandidate {
  primaryId: string;
  duplicateId: string;
  primarySourceId: string;
  duplicateSourceId: string;
  matchScore: number;
  centroidDistanceMeters: number;
  explanation: string;
}

export interface MergedIngestionOutput extends IngestionOutput<IngestionTrailRecord> {
  duplicateCandidates: DuplicateCandidate[];
  linkedSourceRecordCount: number;
}
