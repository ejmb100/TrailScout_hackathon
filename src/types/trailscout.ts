import type { TrailPoint } from '../services/osmService';

export type TrailScoutSourceKind = 'official_public' | 'open_public' | 'commercial_reference' | 'derived';

export interface SourceAttribution {
  sourceId: string;
  name: string;
  kind: TrailScoutSourceKind;
  primary: boolean;
  url?: string;
  lastUpdated?: string;
  confidence: number;
  warnings: string[];
}

export interface NormalizedTrail {
  id: string;
  sourceIds: string[];
  name: string;
  geometry: TrailPoint[];
  distanceKm: number;
  elevationGainM?: number;
  elevationLossM?: number;
  minElevationM?: number;
  maxElevationM?: number;
  routeType: 'loop' | 'out_and_back' | 'point_to_point' | 'unknown';
  surface?: string;
  permittedUses: string[];
  difficultySignals: string[];
  managingAgency?: string;
  sourceConfidence: number;
  sourceAttribution: SourceAttribution[];
  lastUpdated?: string;
}

export interface NormalizedTrailSegment {
  id: string;
  parentTrailId?: string;
  geometry: TrailPoint[];
  distanceKm: number;
  elevationGainM?: number;
  surface?: string;
  grade?: string;
  access?: string;
  source: SourceAttribution;
}

export interface NormalizedTrailhead {
  id: string;
  name: string;
  coordinates: TrailPoint;
  parkingAvailable?: boolean;
  toilets?: boolean;
  water?: boolean;
  accessNotes?: string;
  source: SourceAttribution;
  confidence: number;
}

export interface NormalizedCampsite {
  id: string;
  name: string;
  coordinates: TrailPoint;
  type: 'campground' | 'campsite' | 'dispersed' | 'backcountry' | 'hut' | 'shelter';
  reservationRequired?: boolean;
  permitRequired?: boolean;
  feeRequired?: boolean;
  amenities: string[];
  seasonOpen?: string;
  managingAgency?: string;
  source: SourceAttribution;
  sourceUrl?: string;
  confidence: number;
}

export interface NormalizedRecreationArea {
  id: string;
  name: string;
  boundary?: TrailPoint[];
  managingAgency?: string;
  rules: string[];
  permits: string[];
  alerts: string[];
  source: SourceAttribution;
}

export interface PermitRequirement {
  id: string;
  areaId?: string;
  trailId?: string;
  campsiteId?: string;
  required: boolean;
  requirementType: 'wilderness' | 'camping' | 'parking' | 'entry' | 'unknown';
  season?: string;
  bookingSource?: string;
  notes: string;
  confidence: number;
}

export interface SeasonalitySignal {
  id: string;
  geography: string;
  month: string;
  snowRisk: 'low' | 'moderate' | 'high' | 'unknown';
  heatRisk: 'low' | 'moderate' | 'high' | 'unknown';
  fireRisk: 'low' | 'moderate' | 'high' | 'unknown';
  waterAvailabilityRisk: 'low' | 'moderate' | 'high' | 'unknown';
  accessRoadRisk: 'low' | 'moderate' | 'high' | 'unknown';
  source: SourceAttribution;
  confidence: number;
}

export interface TripCandidate {
  id: string;
  title: string;
  routeGeometry: TrailPoint[];
  trailIds: string[];
  campsiteIds: string[];
  trailheadIds: string[];
  durationDays: number;
  totalDistanceKm: number;
  averageDailyDistanceKm: number;
  elevationGainM?: number;
  difficultyScore: number;
  seasonFitScore: number;
  permitComplexityScore: number;
  campsiteConfidenceScore: number;
  accessConfidenceScore: number;
  warnings: string[];
  sourceAttribution: SourceAttribution[];
}
