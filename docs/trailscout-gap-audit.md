# TrailScout Gap Audit

## What Exists Now

- Vite + React TrailScout UI for intent-based hiking/backpacking discovery.
- Gemini-based intent and research agents with deterministic fallbacks.
- OSM trail fetching through an Overpass proxy.
- USFS EDW trail and recreation-site fetching.
- COTREX trail fetching for Colorado, including long-route query support.
- RIDB facility proxy and client adapter for Recreation.gov enrichment.
- USGS 3DEP/Open-Elevation elevation enrichment.
- Open-Meteo short-range weather.
- WFIGS wildfire incident/perimeter warnings.
- Multi-day route assembly, campsite snapping, itinerary generation, feasibility/safety gates, and planner confidence.
- Result cards, trip plan view, maps, campsite markers, source-aware outbound links, and visible build label.

## Files Defining Core TrailScout Behavior

- Data models / contracts: `src/services/osmService.ts`, `src/services/campsiteService.ts`, `src/services/campsiteStatusService.ts`, `src/services/geminiService.ts`, `src/planner/types.ts`, `src/types/trailscout.ts`
- Source ingestion: `src/services/osmService.ts`, `src/services/officialTrailService.ts`, `src/services/cotrexService.ts`, `src/services/campsiteService.ts`, `src/services/recreationGovService.ts`, `src/services/elevationService.ts`, `src/services/weatherService.ts`, `src/services/forestAlertService.ts`, `api/overpass.js`, `api/ridb.js`, `server/viteApiPlugin.ts`
- Query parsing: `src/services/geminiService.ts`
- Ranking/matching/planning: `src/utils/trailScoring.ts`, `src/services/routeBuilder.ts`, `src/planner/feasibility.ts`, `src/planner/safety.ts`, `src/planner/rank.ts`, `src/planner/itinerary.ts`, `src/planner/effort.ts`
- UI output: `src/App.tsx`, `src/components/TrailResultCard.tsx`, `src/components/TripPlanView.tsx`, `src/components/MapContainer.tsx`, `src/components/MapLibreTerrainMap.tsx`
- Source attribution: `src/utils/sourceAttribution.ts`, `src/utils/externalTrailLinks.ts`

## Source Separation

Official/open/public sources are used as backend inputs: OSM, USFS EDW, RIDB, COTREX, USGS 3DEP, Open-Meteo, and WFIGS. Commercial/community trail apps are not used as backend sources. AllTrails is only an outbound reference link for user review/comparison.

No Marathon Preview or Orientr modules were found in the TrailScout runtime. One test used "marathon-style" language for a hiking training program, but the implementation itself remains hiking/backpacking-specific.

## What Was Missing

- Natural-language multi-day intent could be overridden by the UI default day-hike selector.
- Intent schema did not explicitly expose activity, duration days, route type, overnight implication, campsite requirement, permit check, seasonality check, snow-risk check, or access check.
- Normalized entity interfaces for the intended product were not present.
- Source attribution was mostly implicit in `tags` and not consistently surfaced.
- Safety warnings did not consistently include permit, campsite availability, access, and open-data incompleteness warnings.
- Deterministic scoring used source type but not a reusable source-confidence model.
- Documentation for data sources, architecture, and known gaps was absent.

## Corrections Made

- Added structured intent fields and conservative heuristic inference in `geminiService.ts`.
- Changed `App.tsx` so parsed multi-day/overnight intent is respected even if the UI is left on the day-hike default.
- Added normalized TrailScout contracts in `src/types/trailscout.ts`.
- Added `src/utils/sourceAttribution.ts` and source attribution tests.
- Displayed source attribution and confidence in trail cards and trip plans.
- Added source-confidence contribution to deterministic scoring.
- Added conservative permit, campsite availability, seasonality, and access warnings.
- Added documentation for sources, architecture, and this audit.

## Remaining TODOs

- Move Gemini calls server-side; client-bundled keys are not a production security model.
- Confirm Vercel `/api/overpass` and `/api/ridb` production handlers are healthy after every deploy.
- Extend RIDB integration from `/facilities` to `/campsites`, media, facility addresses, and permit entrances.
- Add NPS connector for park alerts, campgrounds, boundaries, and permit information.
- Add BLM/state/local open-data connectors with source-specific attribution.
- Add climate normals/SNOTEL/NRCS snowpack and road-closure feeds for real seasonality confidence.
- Add campsite and permit complexity directly into candidate scoring once normalized campsite/permit entities are populated.
- Expand official source URL support for USFS/BLM/NPS layers.
- Add a user-visible "data completeness" panel that explains missing sources for the selected region.

## Risks

- Public APIs may throttle, fail, or change schema.
- Current seasonality is conservative and approximate; it is not a substitute for live snowpack, road, or closure data.
- Some routes are assembled from simplified geometries and require field verification.
- Campsite recommendations are not reservations or permits.
- Commercial/community trail apps cannot be used as backend data without explicit license.

## Recommended Next Milestone

Stabilize the Colorado multi-day path: verify live Vercel API routes, add RIDB campsite-level enrichment, then add a source completeness panel so a user can see which public sources supported or failed for each recommendation.
