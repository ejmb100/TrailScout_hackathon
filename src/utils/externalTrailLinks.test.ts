import { describe, expect, it } from 'vitest';
import { buildAllTrailsSearchUrl, buildExternalTrailLinks, buildRecreationGovSearchUrl } from './externalTrailLinks';

describe('externalTrailLinks', () => {
  it('builds AllTrails search from trail name and region', () => {
    const url = buildAllTrailsSearchUrl('Deer Creek Trail', 'Colorado');
    expect(url).toBe('https://www.alltrails.com/search?q=Deer%20Creek%20Trail%20Colorado');
  });

  it('builds Recreation.gov search query', () => {
    expect(buildRecreationGovSearchUrl('Maroon Bells')).toBe(
      'https://www.recreation.gov/search?q=Maroon%20Bells'
    );
  });

  it('includes COTREX official URL when present on trail tags', () => {
    const links = buildExternalTrailLinks(
      {
        id: 1,
        name: 'Bear Lake Trail',
        path: [{ lat: 40.3, lng: -105.6 }],
        tags: {
          url: 'https://trails.colorado.gov/trail/bear-lake',
          trailscout_source: 'cotrex',
        },
      },
      'Rocky Mountain National Park'
    );

    expect(links.map((link) => link.id)).toEqual(['alltrails', 'cotrex', 'recreation-gov']);
    expect(links[1].href).toBe('https://trails.colorado.gov/trail/bear-lake');
  });
});
