import registryData from './registry.json';
import type { SourceRegistryEntry } from './types';

export const sourceRegistry = registryData as SourceRegistryEntry[];

const REQUIRED_FIELDS: (keyof SourceRegistryEntry)[] = [
  'id',
  'name',
  'category',
  'endpoint',
  'licenseOrTerms',
  'attributionRequirement',
  'commercialUseStatus',
  'cachingStatus',
  'redistributionStatus',
  'updateFrequency',
  'notes',
  'ingestible',
];

export function validateSourceRegistry(entries: SourceRegistryEntry[] = sourceRegistry): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    for (const field of REQUIRED_FIELDS) {
      const value = entry[field];
      if (value == null || value === '') {
        issues.push(`entry ${index}: missing ${field}`);
      }
    }

    if (ids.has(entry.id)) {
      issues.push(`duplicate source id: ${entry.id}`);
    }
    ids.add(entry.id);

    if (/alltrails|trailforks|gaia|komoot|hiking project/i.test(`${entry.id} ${entry.name}`) && entry.ingestible) {
      issues.push(`${entry.id}: proprietary hiking platforms must not be ingestible without explicit license`);
    }
  }

  return issues;
}

export function getSourceById(id: string): SourceRegistryEntry {
  const entry = sourceRegistry.find((source) => source.id === id);
  if (!entry) throw new Error(`Unknown TrailScout source: ${id}`);
  return entry;
}
