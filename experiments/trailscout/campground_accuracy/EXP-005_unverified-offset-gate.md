# EXP-005 Unverified campground too far from route

- Experiment ID: EXP-005
- Date: 2026-05-19
- Failure mode tested: Recommending an unverified campground that is technically within the broad route snap radius but too far off-route to be a plausible overnight stop.

## Test inputs
Colorado-only synthetic fixture representing sparse remote public land:
- Query context: remote public-land route with one off-route campground feature
- Site: `Remote Mesa Campground`
- Source record: USFS EDW-style campground record
- RIDB match: none
- Offset from mapped route: ~2.2 km
- Route: two-day route passing near but not directly to the campground

## Baseline behavior
Before the change, the itinerary planner allowed unverified EDW-only campgrounds up to the global 3 km snap radius. That could make a weak, off-route record look like an overnight plan component.

## Change made
Added a stricter `MAX_UNVERIFIED_OVERNIGHT_OFFSET_KM = 1.6` gate in `src/planner/itinerary.ts`. Confirmed/walk-in facilities can still use the broader snap radius, but unverified facilities must be closer to the mapped route.

## Post-change behavior
`Remote Mesa Campground` is not used as an overnight stop. The itinerary falls back to `unknown_unverified` and warns that no confirmed legal campsite was found.

## Campground validation results
- Remote Mesa Campground: source-backed but too weak/far for itinerary use without RIDB/status confirmation.
- Source/dataset: USFS EDW-style fixture only.
- Confidence: low for itinerary use; rejected.

## Itinerary realism assessment
Improved. The route no longer assumes a 2+ km off-route unverified campsite is appropriate for a daily stop.

## Decision
KEEP.

## Quality score
- Campground precision: improved
- Campground recall: slightly reduced for off-route EDW-only sites; acceptable because accuracy is prioritized
- Itinerary realism: improved
- Source confidence: improved
- User clarity: improved

## Next recommended experiment
Replace straight-line offset with actual road/trail access distance where possible, especially for campgrounds separated from trails by terrain or private land.
