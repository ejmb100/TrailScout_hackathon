import type { TrailData } from '../services/osmService';
import type { SourceAttribution } from '../types/trailscout';

function sourceFromTrail(trail: TrailData): SourceAttribution {
  const tags = trail.tags ?? {};
  const src = tags.trailscout_source ?? 'osm';

  if (src === 'cotrex') {
    return {
      sourceId: tags.cotrex_feature_id ?? String(trail.id),
      name: 'Colorado Trail Explorer (COTREX)',
      kind: 'official_public',
      primary: true,
      url: tags.url,
      confidence: 86,
      warnings: ['Verify current closures, permits, and seasonal access with the managing agency.'],
    };
  }

  if (src.includes('usfs_nfs')) {
    return {
      sourceId: tags.usfs_trail_no ?? String(trail.id),
      name: tags.forest_name ? `USDA Forest Service (${tags.forest_name})` : 'USDA Forest Service',
      kind: 'official_public',
      primary: true,
      confidence: 88,
      warnings: ['USFS geometry is authoritative, but current conditions and closures still require land-manager verification.'],
    };
  }

  if (src === 'assembled_route') {
    return {
      sourceId: tags.assembled_source_ids ?? String(trail.id),
      name: `TrailScout assembled route (${tags.assembled_sources ?? 'public trail sources'})`,
      kind: 'derived',
      primary: true,
      confidence: 68,
      warnings: ['Route continuity is inferred from public segments; verify the exact route before navigation.'],
    };
  }

  if (src === 'osm_relation') {
    return {
      sourceId: String(trail.id),
      name: 'OpenStreetMap route relation',
      kind: 'open_public',
      primary: true,
      confidence: 72,
      warnings: ['OSM is community-maintained; confirm access, permits, and current trail conditions.'],
    };
  }

  return {
    sourceId: String(trail.id),
    name: 'OpenStreetMap way segment',
    kind: 'open_public',
    primary: true,
    confidence: 58,
    warnings: ['Mapped geometry may be only part of a larger trail; do not treat this as a complete route without verification.'],
  };
}

export function buildTrailSourceAttribution(trail: TrailData): SourceAttribution[] {
  const primary = sourceFromTrail(trail);
  const supporting: SourceAttribution[] = [];

  if (trail.elevationGainM != null || trail.elevationLossM != null) {
    supporting.push({
      sourceId: 'usgs-3dep-or-open-elevation',
      name: 'Elevation model',
      kind: 'open_public',
      primary: false,
      confidence: 70,
      warnings: ['Elevation is sampled and should be treated as approximate.'],
    });
  }

  return [primary, ...supporting];
}

export function primarySourceLabel(trail: TrailData): string {
  return buildTrailSourceAttribution(trail)[0]?.name ?? 'Unknown public source';
}

export function trailSourceConfidence(trail: TrailData): number {
  return buildTrailSourceAttribution(trail)[0]?.confidence ?? 45;
}
