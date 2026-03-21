/**
 * Service to interact with the OpenStreetMap Overpass API.
 * Responsible for fetching trail geometry and metadata.
 */

export interface TrailPoint {
  lat: number;
  lng: number;
}

export interface TrailData {
  id: number;
  name: string;
  path: TrailPoint[];
  tags: Record<string, string>;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Fetches hiking trails within a given bounding box.
 * @param south Minimum latitude
 * @param west Minimum longitude
 * @param north Maximum latitude
 * @param east Maximum longitude
 */
export async function fetchTrailsInBBox(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<TrailData[]> {
    const query = `
      [out:json][timeout:25];
      (
        way["highway"~"path|footway|track"]["name"](${south},${west},${north},${east});
        way["route"="hiking"](${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;

  try {
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`);
    if (!response.ok) {
        throw new Error(`Overpass API error: ${response.statusText}`);
    }
    const data = await response.json();
    return parseOverpassResponse(data);
  } catch (error) {
    console.error('Failed to fetch trails from OSM:', error);
    return [];
  }
}

/**
 * Parses the raw Overpass JSON response into structured TrailData.
 */
function parseOverpassResponse(data: any): TrailData[] {
  const nodes: Record<number, TrailPoint> = {};
  const trails: TrailData[] = [];

  // Index nodes for quick lookup
  for (const element of data.elements) {
    if (element.type === 'node') {
      nodes[element.id] = { lat: element.lat, lng: element.lon };
    }
  }

  // Create trail paths from ways
  for (const element of data.elements) {
    if (element.type === 'way') {
      const path: TrailPoint[] = (element.nodes || [])
        .map((nodeId: number) => nodes[nodeId])
        .filter(Boolean);

      if (path.length > 0) {
        trails.push({
          id: element.id,
          name: element.tags?.name || `Unnamed Trail (${element.id})`,
          path,
          tags: element.tags || {},
        });
      }
    }
  }

  return trails;
}
