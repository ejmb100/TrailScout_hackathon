/**
 * Forest alert service — queries public federal GIS feeds for active fire
 * perimeters and incidents that may affect trail and campsite accessibility.
 *
 * Sources:
 *   - NIFC WFIGS Interagency Perimeters (ArcGIS FeatureServer, no auth)
 *   - NIFC WFIGS Active Incident Points  (ArcGIS FeatureServer, no auth)
 *
 * Future: USFS closure orders when a stable public API becomes available.
 */

const PERIMETERS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query';
const INCIDENTS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

export interface FirePerimeter {
  id: number;
  name: string;
  acres: number;
  containment: number | null;
  discoveredDate: string;
  updatedDate: string;
}

export interface FireIncident {
  id: number;
  name: string;
  lat: number;
  lng: number;
  acres: number;
  containment: number | null;
  cause: string;
  discoveredDate: string;
  updatedDate: string;
  isActive: boolean;
}

export interface ForestAlerts {
  perimeters: FirePerimeter[];
  incidents: FireIncident[];
  fetchedAt: string;
  hasActiveFiresInArea: boolean;
}

function epochToIso(ms: number | null | undefined): string {
  if (!ms) return '';
  try { return new Date(ms).toISOString(); } catch { return ''; }
}

let cachedAlerts: ForestAlerts | null = null;
let cachedAlertBBox = '';

export async function fetchForestAlerts(
  south: number, west: number, north: number, east: number
): Promise<ForestAlerts> {
  const bboxKey = `${south},${west},${north},${east}`;
  if (bboxKey === cachedAlertBBox && cachedAlerts) return cachedAlerts;

  const geom = `${west},${south},${east},${north}`;
  const perimeters: FirePerimeter[] = [];
  const incidents: FireIncident[] = [];

  const [perimResult, incidentResult] = await Promise.allSettled([
    fetchPerimeters(geom),
    fetchIncidents(geom),
  ]);

  if (perimResult.status === 'fulfilled') perimeters.push(...perimResult.value);
  else console.warn('[ForestAlerts] perimeter fetch failed:', perimResult.reason);

  if (incidentResult.status === 'fulfilled') incidents.push(...incidentResult.value);
  else console.warn('[ForestAlerts] incident fetch failed:', incidentResult.reason);

  const result: ForestAlerts = {
    perimeters,
    incidents,
    fetchedAt: new Date().toISOString(),
    hasActiveFiresInArea: incidents.some(i => i.isActive) || perimeters.length > 0,
  };

  cachedAlerts = result;
  cachedAlertBBox = bboxKey;
  console.info(`[ForestAlerts] ${perimeters.length} perimeters, ${incidents.length} incidents in bbox`);
  return result;
}

async function fetchPerimeters(geom: string): Promise<FirePerimeter[]> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: geom,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,poly_IncidentName,poly_GISAcres,poly_PercentContained,FireDiscoveryDateTime,DateCurrent',
    f: 'json',
    resultRecordCount: '50',
  });

  const res = await fetch(`${PERIMETERS_URL}?${params}`);
  if (!res.ok) throw new Error(`NIFC perimeters HTTP ${res.status}`);
  const data = await res.json();
  const features: unknown[] = data.features ?? [];

  return features.map((raw) => {
    const a = (raw as Record<string, unknown>).attributes as Record<string, unknown>;
    return {
      id: Number(a.OBJECTID) || 0,
      name: String(a.poly_IncidentName ?? '').trim(),
      acres: Number(a.poly_GISAcres) || 0,
      containment: Number.isFinite(Number(a.poly_PercentContained)) ? Number(a.poly_PercentContained) : null,
      discoveredDate: epochToIso(a.FireDiscoveryDateTime as number),
      updatedDate: epochToIso(a.DateCurrent as number),
    };
  });
}

async function fetchIncidents(geom: string): Promise<FireIncident[]> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: geom,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,IncidentName,DailyAcres,PercentContained,FireCause,FireDiscoveryDateTime,ModifiedOnDateTime_dt,IsActive',
    returnGeometry: 'true',
    f: 'json',
    resultRecordCount: '100',
  });

  const res = await fetch(`${INCIDENTS_URL}?${params}`);
  if (!res.ok) throw new Error(`NIFC incidents HTTP ${res.status}`);
  const data = await res.json();
  const features: unknown[] = data.features ?? [];

  return features.map((raw) => {
    const f = raw as Record<string, Record<string, unknown>>;
    const a = f.attributes ?? {};
    const g = f.geometry ?? {};
    return {
      id: Number(a.OBJECTID) || 0,
      name: String(a.IncidentName ?? '').trim(),
      lat: Number(g.y) || 0,
      lng: Number(g.x) || 0,
      acres: Number(a.DailyAcres) || 0,
      containment: Number.isFinite(Number(a.PercentContained)) ? Number(a.PercentContained) : null,
      cause: String(a.FireCause ?? '').trim(),
      discoveredDate: epochToIso(a.FireDiscoveryDateTime as number),
      updatedDate: epochToIso(a.ModifiedOnDateTime_dt as number),
      isActive: a.IsActive === 'Y' || a.IsActive === true,
    };
  });
}

export function getForestAlerts(): ForestAlerts | null {
  return cachedAlerts;
}
