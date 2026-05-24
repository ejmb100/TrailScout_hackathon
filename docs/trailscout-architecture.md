# TrailScout Architecture

## Product Scope

TrailScout is an intent-based hiking and backpacking discovery product. It parses natural-language requests such as "Find a four-day hiking trail in Colorado in July" into structured constraints, then searches public/open data for trails, campsites, access context, weather, elevation, and safety warnings.

TrailScout is separate from:

- Marathon Preview: official road-race course preview. Marathon-specific course, aid-station, timing, and race-day logic should not live in TrailScout modules.
- Orientr: VR orienteering simulation. Orienteering controls, scoring, VR simulation, and game-specific routing should not live in TrailScout modules.

Shared geospatial utilities may be extracted later, but TrailScout modules should remain hiking/backpacking-specific.

## Source Pipeline

1. `src/services/geminiService.ts` parses user intent with Gemini and conservative fallbacks.
2. `src/App.tsx` widens the intent bbox for multi-day discovery and fetches:
   - OSM via `src/services/osmService.ts` and `/api/overpass`
   - USFS trails via `src/services/officialTrailService.ts`
   - COTREX trails via `src/services/cotrexService.ts`
   - USFS campsite/recreation sites via `src/services/campsiteService.ts`
   - RIDB facilities via `src/services/recreationGovService.ts` and `/api/ridb`
   - WFIGS fire context via `src/services/forestAlertService.ts`
   - Open-Meteo forecast via `src/services/weatherService.ts`
3. `src/services/trailMergeService.ts` merges official and OSM trails, preserving official geometry where matched.
4. `src/services/routeBuilder.ts` assembles adjacent multi-day route candidates from public trail segments.
5. `src/services/elevationService.ts` adds elevation gain/loss from USGS 3DEP or fallback elevation services.
6. `src/utils/trailScoring.ts` applies source-aware deterministic scoring before planner validation.
7. `src/planner/*` assesses feasibility, safety, effort, campsite itinerary, and final planner recommendation.
8. UI components (`TrailResultCard`, `TripPlanView`, `MapContainer`) display routes, warnings, source attribution, external links, and campsite markers.

## Normalized Schema

Current runtime shape is `TrailData` plus campsite/status/planner types. The intended normalized schema is captured in `src/types/trailscout.ts`:

- `NormalizedTrail`
- `NormalizedTrailSegment`
- `NormalizedTrailhead`
- `NormalizedCampsite`
- `NormalizedRecreationArea`
- `PermitRequirement`
- `SeasonalitySignal`
- `TripCandidate`
- `SourceAttribution`

This file is a contract for future connectors. Existing runtime code should migrate toward these entities incrementally rather than replacing the current app in one rewrite.

## Intent Parser

The parser should identify:

- activity (`hiking` or `backpacking`)
- location
- duration/trip days
- month/season
- overnight implication
- route type
- difficulty
- campsite requirement
- permit, seasonality, snow-risk, and access-check requirements

Multi-day hiking language (for example "four-day hiking trail") is treated as backpacking/multi-day even if the UI segmented control remains on the default day-hike setting.

## Matching And Ranking

Scoring currently accounts for:

- distance/duration fit
- multi-day route floor
- difficulty tags
- elevation/effort proxy
- source confidence
- source URL/access tags
- route assembly
- deterministic feasibility and safety gates

Remaining scoring hooks should add richer campsite support, permit complexity, data freshness, official closure status, road access, water availability, and historical seasonality.

## Validation Flow

Planner validation is intentionally conservative:

- `feasibility.ts` blocks routes that are too short/long or have insufficient geometry.
- `safety.ts` adds technical, weather, dog, snow, wilderness, permit, campsite, access, and open-data incompleteness warnings.
- `itinerary.ts` builds multi-day segments and campsite recommendations only from public campsite data; unverified gaps are surfaced.

TrailScout must never present a recommendation as guaranteed safe or legal. Output should direct users to official land managers and reservation/permit sources.

## Source Attribution Rules

Every result should preserve:

- primary source
- supporting sources
- source URL where available
- confidence
- warnings
- official verification link where available

`src/utils/sourceAttribution.ts` maps current `TrailData.tags.trailscout_source` values into `SourceAttribution`. New connectors must set source IDs and URLs rather than overwriting provenance.

## First Prototype Milestone

The next best milestone is to complete a stable Colorado backpacking prototype:

1. OSM/Overpass and RIDB serverless routes return non-500 responses in production.
2. COTREX + USFS trails produce at least one route-length candidate for a four-day Colorado query.
3. Campsite markers appear on both result and trip-plan maps.
4. Results show source attribution, confidence, and conservative warnings.
5. RIDB `/campsites` and NPS alerts are planned but not falsely claimed as complete.
