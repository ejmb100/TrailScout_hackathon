import type { TrailData } from './osmService';

export const isIngestedCatalogEnabled = import.meta.env.VITE_USE_INGESTED_CATALOG === 'true';

export interface FetchIngestedTrailOptions {
  south: number;
  west: number;
  north: number;
  east: number;
  query?: string;
  limit?: number;
}

export async function fetchIngestedTrailData(options: FetchIngestedTrailOptions): Promise<TrailData[]> {
  if (!isIngestedCatalogEnabled) return [];

  const params = new URLSearchParams({
    south: String(options.south),
    west: String(options.west),
    north: String(options.north),
    east: String(options.east),
    limit: String(options.limit ?? 100),
  });
  if (options.query) params.set('q', options.query);

  try {
    const response = await fetch(`/api/ingested-trails?${params}`);
    if (!response.ok) {
      console.warn(`[Ingested Catalog] HTTP ${response.status}; continuing without local baseline`);
      return [];
    }
    const data = await response.json();
    return Array.isArray(data.trails) ? data.trails : [];
  } catch (error) {
    console.warn('[Ingested Catalog] fetch failed; continuing without local baseline:', error);
    return [];
  }
}
