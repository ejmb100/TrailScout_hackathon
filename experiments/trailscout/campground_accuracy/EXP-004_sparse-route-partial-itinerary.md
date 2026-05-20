# EXP-004 Sparse-route partial itinerary fallback

- Experiment ID: EXP-004
- Date: 2026-05-19
- Failure mode tested: Creating multi-day itinerary segments after an overnight gap where no source-backed campground exists.

## Test inputs
Colorado-only synthetic fixture representing a sparse remote public-land route:
- Query context: remote Colorado route with sparse campgrounds
- Route: four-day route geometry
- Campground data: none near route

## Baseline behavior
Before the change, when no campsite was found for an overnight stop, the planner still advanced the route to an ideal kilometer marker and generated later days. That produced daily starts implicitly based on an invalid overnight assumption, even though the notes said no confirmed campsite existed.

## Change made
Updated `src/planner/itinerary.ts` so that after the first missing overnight stop, TrailScout logs a partial-itinerary warning and stops generating further route days. This favors a partial itinerary over an apparently complete but unsupported itinerary.

## Post-change behavior
The sparse route produces one day with `unknown_unverified` campground metadata, no campsite, and a warning that the itinerary is partial because TrailScout will not infer an overnight stop from route progress alone.

## Campground validation results
- No campgrounds recommended.
- Source/dataset: none found near route.
- Confidence: high that no source-backed stop should be shown.

## Itinerary realism assessment
Improved. The system no longer creates downstream days that assume an overnight at an unverified arbitrary route point.

## Decision
KEEP.

## Quality score
- Campground precision: improved by recommending zero invalid campsites
- Campground recall: unchanged; no source-backed campsite exists in test fixture
- Itinerary realism: improved
- Source confidence: improved
- User clarity: improved

## Next recommended experiment
Tighten off-route distance constraints for unverified campgrounds.
