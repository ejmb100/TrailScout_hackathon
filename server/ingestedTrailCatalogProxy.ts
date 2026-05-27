import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createIngestedTrailCatalog,
  queryIngestedTrailData,
} from '../src/sources/ingestedTrailCatalog';
import type { MergedIngestionOutput } from '../src/sources/types';
import type { BBox } from '../src/lib/geo';

export interface IngestedTrailProxyResult {
  status: number;
  text: string;
}

function latestCuratedPath(root: string): string | null {
  const ingestionDir = resolve(root, 'data/ingestion');
  if (!existsSync(ingestionDir)) return null;

  const latest = readdirSync(ingestionDir)
    .filter((name) => /-san-juan-curated\.json$/.test(name))
    .sort()
    .at(-1);

  return latest ? resolve(ingestionDir, latest) : null;
}

function parseNumber(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : null;
}

function parseBBox(params: URLSearchParams): BBox | undefined {
  const south = parseNumber(params, 'south');
  const west = parseNumber(params, 'west');
  const north = parseNumber(params, 'north');
  const east = parseNumber(params, 'east');
  if (south == null || west == null || north == null || east == null) return undefined;
  return { south, west, north, east };
}

export function queryIngestedTrails(url: string | undefined, root: string): IngestedTrailProxyResult {
  const curatedPath = latestCuratedPath(root);
  if (!curatedPath) {
    return {
      status: 404,
      text: JSON.stringify({ trails: [], error: 'No curated San Juan ingestion file found' }),
    };
  }

  const requestUrl = new URL(url || '/api/ingested-trails', 'http://localhost');
  const limit = parseNumber(requestUrl.searchParams, 'limit') ?? 100;
  const bbox = parseBBox(requestUrl.searchParams);
  const text = requestUrl.searchParams.get('q') || undefined;
  const output = JSON.parse(readFileSync(curatedPath, 'utf8')) as MergedIngestionOutput;
  const catalog = createIngestedTrailCatalog(output);
  const trails = queryIngestedTrailData(catalog, { bbox, text, limit });

  return {
    status: 200,
    text: JSON.stringify({
      source: 'local-curated-ingestion',
      runId: catalog.runId,
      label: catalog.label,
      path: curatedPath,
      trails,
    }),
  };
}
