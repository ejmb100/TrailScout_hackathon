# TrailScout Colorado Campground Accuracy Recursive Improvement Summary

Date: 2026-05-19
Project: TrailScout
Scope: Colorado-only campground validation and daily itinerary realism

## Objective
Improve recommendation quality for Colorado trip planning with emphasis on evidence-based campground identification and itinerary generation that does not hallucinate overnight stops.

## Test set coverage
The bounded loop used Colorado-only synthetic fixtures covering:
- mountain route / seasonal mountain campground: EXP-001
- popular park/day-use confusion: EXP-002
- remote public land / nearby unrelated campground: EXP-003
- sparse campground route: EXP-004
- remote public land / off-route unverified campground: EXP-005

## Experiments run

### EXP-001: Seasonal campground closure gating
- Failure mode: EDW-only seasonal campgrounds outside open season were merely `unverified`.
- Change: parse EDW open-season month ranges for EDW-only records and classify outside-season sites as `seasonal_closure`.
- Decision: KEEP.

### EXP-002: Day-use camping-area false positive
- Failure mode: `CAMPING AREA` records with day-use/picnic activities could be treated as overnight stops.
- Change: require `camping_area` records to explicitly include overnight/camping/backpacking activity before itinerary use.
- Decision: KEEP.

### EXP-003: RIDB nearby-name mismatch
- Failure mode: unrelated nearby Recreation.gov campground could confirm the wrong EDW site.
- Change: require near-exact coordinates or shared distinctive name token for RIDB confirmation.
- Decision: KEEP.

### EXP-004: Sparse-route partial itinerary fallback
- Failure mode: planner generated later days after a missing overnight campground, implying an invalid overnight point.
- Change: stop at first unsupported overnight gap and mark the itinerary partial.
- Decision: KEEP.

### EXP-005: Unverified campground offset gate
- Failure mode: EDW-only unverified sites up to 3 km from route could be used as overnight stops.
- Change: cap unverified overnight-use offset at 1.6 km while leaving confirmed/walk-in facilities eligible under the broader snap radius.
- Decision: KEEP.

## Changes kept
- `src/services/campsiteStatusService.ts`
  - conservative EDW open-season classification for EDW-only sites
  - RIDB matching now considers name similarity unless coordinates are near-exact
- `src/planner/itinerary.ts`
  - camping-area overnight eligibility requires explicit camping/backpacking activity
  - unverified campground offset tightened to 1.6 km
  - sparse itinerary generation stops after the first unsupported overnight gap
- Tests/logs:
  - `src/planner/campgroundAccuracy.test.ts`
  - experiment logs under `experiments/trailscout/campground_accuracy/`

## Changes reverted
None. Each kept change improved campground precision or itinerary realism without reducing source transparency in the tested cases.

## Validation commands
- `npm test -- --run src/planner/campgroundAccuracy.test.ts src/services/campsiteStatus.test.ts src/planner/planner.test.ts` passed during the loop.
- Full validation should be run before considering the work final:
  - `npm test`
  - `npm run lint`
  - `npm run build`

## Best known campground validation behavior after loop
TrailScout now behaves more conservatively for Colorado overnight stops:
- It does not use trailheads as overnight campsites.
- It does not use picnic/day-use-only camping-area records as overnight campsites.
- It marks EDW-only seasonal campgrounds as likely closed when the planning date is outside a parseable open season.
- It avoids confirming an EDW site from a nearby RIDB campground unless coordinates are near-exact or names share a distinctive token.
- It stops generating daily itinerary segments after an unsupported overnight gap.
- It rejects off-route EDW-only unverified campgrounds beyond 1.6 km from the mapped route.

## Remaining known weaknesses
- Open-season parsing is month-level only and does not handle all natural-language season formats.
- The planning date currently uses the date passed to status building; ensure user-requested trip date is consistently propagated into campsite status evaluation.
- RIDB name matching is conservative and may miss valid matches where EDW/RIDB names differ substantially.
- Offset is still straight-line-to-route, not actual trail/road access distance.
- The system still lacks live reservation availability confirmation for many sites.
- Colorado-specific state/local campground datasets beyond USFS EDW/RIDB are not yet integrated.

## Recommended next 5 experiments
1. Propagate the parsed user trip date into `buildCampsiteStatuses` instead of using only fetch/current date.
2. Add Colorado Parks and Wildlife/state-park campground data and validate against known state-park campgrounds.
3. Replace straight-line campsite offset with trail/road-network access distance for confirmed facilities.
4. Add permit/reservation-only labeling for wilderness/NPS/state-park contexts.
5. Add fixture-backed tests for actual known Colorado routes: Colorado Trail segment, Lost Creek Wilderness, Indian Peaks, San Juan/Weminuche, and a sparse BLM route.

## Safety assessment
TrailScout is safer than before for Colorado daily itinerary campground recommendations, but not fully safe for real-world reliance. It is appropriate for exploratory planning with explicit verification warnings. It is not yet safe enough to present as a complete authoritative overnight itinerary planner because live availability, exact access routes, permit requirements, and some state/local campground sources remain incomplete.
