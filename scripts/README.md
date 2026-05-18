# Data ETL scripts

These scripts pull **USDA Forest Service Enterprise Data Warehouse (EDW)** layers into JSON under `src/data/`. Refresh periodically (e.g. monthly or before releases) so bundled snapshots match current trails and recreation sites.

## Colorado USFS trails

```bash
npx tsx scripts/fetch-usfs-colorado.ts
```

Writes `src/data/usfs-colorado.json` (large file). The app also queries **EDW at runtime** via `officialTrailService` for the search bbox; the static file is optional for offline or bundling.

## Colorado USFS recreation sites (campgrounds, camping areas, trailheads)

```bash
npx tsx scripts/fetch-usfs-campsites-colorado.ts
```

Writes `src/data/usfs-colorado-campsites.json`. Used for campsite proximity and multi-day itinerary snapping.

## Scheduling

- **Production:** run both scripts on a schedule (CI cron or manual) and commit updated JSON when you want a new baseline.
- **Verification:** spot-check a few known trail lengths after stitching (see script logs) and compare high-traffic sites to [recreation.gov](https://www.recreation.gov) or the local forest site.

## Terms

Respect EDW and ArcGIS usage terms; data is **not for sole navigation** — verify conditions in the field.
