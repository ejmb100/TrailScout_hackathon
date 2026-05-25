import type { TrailPoint } from '../services/osmService';
import type { SourceAttribution } from '../types/trailscout';
import {
  bboxQueryValue,
  flattenLineGeometry,
  kmToMiles,
  lineLengthKm,
  milesToKm,
  roundPoint,
  type BBox,
} from '../lib/geo';
import { getSourceById } from './registry';
import type { IngestionTrailRecord } from './types';

export const SAN_JUAN_BBOX: BBox = {
  south: 37.0,
  west: -108.5,
  north: 38.5,
  east: -106.5,
};

export const DEFAULT_TNM_TRANSPORTATION_MAPSERVER =
  'https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer';
export const TNM_TRAILS_LAYER_ID = 37;
export const TNM_TRAILS_PAGE_SIZE = 2000;

interface GeoJsonFeature {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

interface GeoJsonFeatureCollection {
  type?: string;
  features?: GeoJsonFeature[];
  exceededTransferLimit?: boolean;
  properties?: {
    exceededTransferLimit?: boolean;
  };
}

function safeString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function truthyUse(value: unknown): boolean {
  return /^(y|yes|true|1)$/i.test(safeString(value));
}

function titleCaseUse(use: string): string {
  return use.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (char) => char.toUpperCase());
}

function allowedUsesFromProperties(properties: Record<string, unknown>): string[] {
  const useFields = [
    'hikerpedestrian',
    'bicycle',
    'packsaddle',
    'motorcycle',
    'ohvover50inches',
    'ohvisorunder50inches',
    'snowshoe',
    'crosscountryski',
    'pets',
    'livestock',
    'ebike',
  ];

  return useFields
    .filter((field) => truthyUse(properties[field]))
    .map((field) => (field === 'hikerpedestrian' ? 'hiking' : titleCaseUse(field)));
}

function sourceAttribution(lastUpdated?: string): SourceAttribution {
  const source = getSourceById('usgs-tnm-trails');
  return {
    sourceId: source.id,
    name: source.name,
    kind: 'official_public',
    primary: true,
    url: source.endpoint,
    lastUpdated,
    confidence: 88,
    warnings: ['USGS/TNM trail geometry is public source data, not a live conditions or closure feed.'],
  };
}

function geometryType(feature: GeoJsonFeature): IngestionTrailRecord['geometryType'] {
  if (feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString') {
    return feature.geometry.type;
  }
  return 'Unknown';
}

export function buildTnmTrailsQueryUrl(
  mapServerUrl = DEFAULT_TNM_TRANSPORTATION_MAPSERVER,
  bbox: BBox = SAN_JUAN_BBOX,
  offset = 0,
  recordCount = TNM_TRAILS_PAGE_SIZE,
): string {
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    geometry: bboxQueryValue(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'objectid,permanentidentifier,name,namealternate,trailnumber,trailtype,hikerpedestrian,bicycle,packsaddle,motorcycle,ohvover50inches,ohvisorunder50inches,snowshoe,crosscountryski,pets,livestock,ebike,primarytrailmaintainer,nationaltraildesignation,lengthmiles,trailsurface,sourceoriginator,sourceeditdate,publisheddate',
    resultOffset: String(offset),
    resultRecordCount: String(recordCount),
  });

  return `${mapServerUrl.replace(/\/$/, '')}/${TNM_TRAILS_LAYER_ID}/query?${params}`;
}

export function normalizeUsgsNdtFeature(feature: GeoJsonFeature): IngestionTrailRecord {
  const properties = feature.properties ?? {};
  const objectId = safeString(properties.objectid) || safeString(properties.OBJECTID) || 'unknown';
  const permanentId = safeString(properties.permanentidentifier) || safeString(properties.PermanentIdentifier);
  const name = safeString(properties.name);
  const trailNumber = safeString(properties.trailnumber);
  const alternateNames = [safeString(properties.namealternate), safeString(properties.trailnumberalternate)]
    .filter(Boolean);
  const canonicalName = name || trailNumber || `USGS TNM Trail ${objectId}`;
  const path = flattenLineGeometry(feature.geometry).map((point) => roundPoint(point));
  const validationIssues: string[] = [];

  if (!name && !trailNumber) validationIssues.push('missing trail name');
  if (path.length === 0) validationIssues.push('empty geometry');
  if (path.length === 1) validationIssues.push('line geometry has fewer than 2 points');

  const sourceEditDate = safeString(properties.sourceeditdate);
  const publishDate = safeString(properties.publisheddate);
  const lengthMilesRaw = Number(properties.lengthmiles);
  const calculatedKm = lineLengthKm(path);
  const distanceKm = Number.isFinite(lengthMilesRaw) && lengthMilesRaw > 0 ? milesToKm(lengthMilesRaw) : calculatedKm;
  const lengthMiles = Number.isFinite(lengthMilesRaw) && lengthMilesRaw > 0 ? lengthMilesRaw : kmToMiles(calculatedKm);
  const allowedUses = allowedUsesFromProperties(properties);
  const maintainer = safeString(properties.primarytrailmaintainer);
  const sourceOriginator = safeString(properties.sourceoriginator);
  const sourceIds = ['usgs-tnm-trails', permanentId || `objectid:${objectId}`];

  return {
    id: `usgs-tnm:${permanentId || objectId}`,
    sourceRecordId: permanentId || objectId,
    sourceIds,
    sourceName: 'USGS The National Map Transportation Trails',
    name: canonicalName,
    canonicalName,
    alternateNames,
    geometry: path,
    originalGeometry: feature.geometry ?? null,
    geometryType: geometryType(feature),
    distanceKm,
    lengthMiles,
    routeType: 'unknown',
    surface: safeString(properties.trailsurface) || undefined,
    trailSurface: safeString(properties.trailsurface) || undefined,
    permittedUses: allowedUses,
    allowedUses,
    difficultySignals: [],
    managingAgency: maintainer || sourceOriginator || undefined,
    landManager: maintainer || undefined,
    sourceConfidence: validationIssues.length === 0 ? 88 : 70,
    confidence: validationIssues.length === 0 ? 88 : 70,
    confidenceFields: {
      geometry: path.length >= 2 ? 90 : 20,
      naming: name || trailNumber ? 85 : 35,
      sourceAuthority: 90,
    },
    sourceAttribution: [sourceAttribution(sourceEditDate || publishDate || undefined)],
    lastUpdated: sourceEditDate || publishDate || undefined,
    validationIssues,
    rawProperties: properties,
  };
}

export function normalizeUsgsNdtFeatureCollection(data: GeoJsonFeatureCollection): IngestionTrailRecord[] {
  return (data.features ?? []).map(normalizeUsgsNdtFeature);
}

export async function fetchUsgsNdtTrails(
  bbox: BBox = SAN_JUAN_BBOX,
  mapServerUrl = process.env.TNM_TRANSPORTATION_MAPSERVER_URL || DEFAULT_TNM_TRANSPORTATION_MAPSERVER,
): Promise<{ raw: GeoJsonFeatureCollection; records: IngestionTrailRecord[] }> {
  const allFeatures: GeoJsonFeature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(buildTnmTrailsQueryUrl(mapServerUrl, bbox, offset));
    if (!response.ok) throw new Error(`USGS/TNM trails HTTP ${response.status}`);
    const page = (await response.json()) as GeoJsonFeatureCollection;
    const features = page.features ?? [];
    allFeatures.push(...features);
    const exceeded = Boolean(page.exceededTransferLimit ?? page.properties?.exceededTransferLimit);
    hasMore = features.length === TNM_TRAILS_PAGE_SIZE || exceeded;
    offset += features.length;
    if (features.length === 0) hasMore = false;
  }

  const raw: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: allFeatures };
  return { raw, records: normalizeUsgsNdtFeatureCollection(raw) };
}

export function toTrailPointArray(path: TrailPoint[]): TrailPoint[] {
  return path.map((point) => ({ lat: point.lat, lng: point.lng }));
}
