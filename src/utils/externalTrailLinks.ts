import type { TrailData } from '../services/osmService';

export interface ExternalTrailLink {
  id: 'alltrails' | 'cotrex' | 'recreation-gov';
  label: string;
  href: string;
}

export function buildAllTrailsSearchUrl(trailName: string, regionHint?: string): string {
  const query = [trailName.trim(), regionHint?.trim()].filter(Boolean).join(' ');
  return `https://www.alltrails.com/search?q=${encodeURIComponent(query || 'hiking trails')}`;
}

export function buildRecreationGovSearchUrl(query: string): string {
  return `https://www.recreation.gov/search?q=${encodeURIComponent(query.trim() || 'campground')}`;
}

/** Outbound links for reviews, official pages, and federal campground search — no AllTrails API. */
export function buildExternalTrailLinks(trail: TrailData, regionHint?: string): ExternalTrailLink[] {
  const name = trail.name?.trim() || 'trail';
  const region = regionHint?.trim();
  const links: ExternalTrailLink[] = [
    {
      id: 'alltrails',
      label: 'AllTrails',
      href: buildAllTrailsSearchUrl(name, region),
    },
  ];

  const cotrexUrl = trail.tags.url?.trim();
  if (cotrexUrl && /^https?:\/\//i.test(cotrexUrl)) {
    links.push({ id: 'cotrex', label: 'COTREX', href: cotrexUrl });
  }

  links.push({
    id: 'recreation-gov',
    label: 'Recreation.gov',
    href: buildRecreationGovSearchUrl(region ? `${name} ${region}` : name),
  });

  return links;
}
