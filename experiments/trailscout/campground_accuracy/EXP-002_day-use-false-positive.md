# EXP-002 Day-use camping-area false positive

- Experiment ID: EXP-002
- Date: 2026-05-19
- Failure mode tested: Recommending picnic/day-use records as overnight camping because the source type resembles a camping area.

## Test inputs
Colorado-only synthetic fixture representing a popular state-park / frontcountry area where day-use sites can be confused with camping:
- Query context: popular Colorado park itinerary with nearby mapped day-use facilities
- Site: `Chatfield Picnic and Day Use Area`
- Source record: USFS EDW-style `CAMPING AREA`
- Activities: `PICNICKING|DAY USE AREA`
- Route: two-day path passing directly by the feature

## Baseline behavior
The test harness now seeds the campsite cache with the day-use feature. Before the production guard, `CAMPING AREA` records were considered official camping facilities regardless of activities, so a day-use-only camping-area-looking record could be selected as an overnight stop.

## Change made
Updated itinerary overnight eligibility in `src/planner/itinerary.ts`:
- `campground` remains eligible by type.
- `camping_area` is eligible only when activities explicitly indicate overnight camping/backpacking.
- Day-use/picnic-only activity strings are not treated as overnight support.

## Post-change behavior
The planner does not use `Chatfield Picnic and Day Use Area` as a campsite. It emits the explicit fallback: no confirmed legal campsite or campground found.

## Campground validation results
- Chatfield Picnic and Day Use Area: invalid for overnight itinerary stop.
- Source/dataset: USFS EDW-style fixture.
- Confidence: high that it should not be used because activities are day-use only.

## Itinerary realism assessment
Improved. The daily itinerary no longer creates an invalid overnight assumption from a day-use map feature.

## Decision
KEEP.

## Quality score
- Campground precision: improved
- Campground recall: slightly more conservative for ambiguous camping-area records
- Itinerary realism: improved
- Source confidence: improved
- User clarity: improved

## Next recommended experiment
Prevent unrelated nearby Recreation.gov facilities from confirming the wrong EDW campground.
