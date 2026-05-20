# EXP-001 Seasonal campground closure gating

- Experiment ID: EXP-001
- Date: 2026-05-19
- Failure mode tested: Using seasonal Colorado campgrounds outside their published open season.

## Test inputs
Colorado-only synthetic fixture representing a mountain campground:
- Query context: five-day Colorado mountain route / Twin Lakes style campground
- Site: `Twin Lakes Mountain Campground`
- Source record: USFS EDW-style campground record
- Open season: `May 15 - September 30`
- Planning date: `2026-01-15T00:00:00Z`
- RIDB match: none

## Baseline behavior
Before the change, EDW-only seasonal campgrounds were classified as `unverified` even when the planning date was clearly outside the EDW open-season text. This left the itinerary layer free to treat the site as an official but unverified overnight option.

## Change made
Added conservative month-range parsing in `src/services/campsiteStatusService.ts` for EDW-only sites. If a site has an interpretable open season and the planning date is outside that range, the status becomes `seasonal_closure` with higher confidence and explicit warning text.

## Post-change behavior
The test site is classified as `seasonal_closure`, confidence 75, with a warning that the open season does not include the requested/planning date.

## Campground validation results
- Twin Lakes Mountain Campground: questionable/invalid for January itinerary; source-backed EDW record, but seasonal closure likely.
- Source/dataset: USFS EDW-style fixture.
- Confidence: medium-high for seasonal closure when month range is parseable.

## Itinerary realism assessment
Improved. The planner no longer treats a clearly out-of-season EDW-only campground as merely unverified.

## Decision
KEEP.

## Quality score
- Campground precision: improved
- Campground recall: unchanged for in-season sites; may conservatively suppress ambiguous out-of-season sites
- Itinerary realism: improved
- Source confidence: improved
- User clarity: improved

## Next recommended experiment
Validate day-use / picnic records that look like camping areas but do not explicitly support overnight camping.
