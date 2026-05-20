# EXP-003 RIDB nearby-name mismatch

- Experiment ID: EXP-003
- Date: 2026-05-19
- Failure mode tested: Confirming an EDW campground from an unrelated nearby Recreation.gov campground.

## Test inputs
Colorado-only synthetic fixture representing remote public-land campgrounds clustered near a popular reservoir:
- Query context: remote Colorado public-land route
- EDW site: `Remote Public Land Primitive Camp`
- Nearby RIDB facility: `Popular Lake RV Campground`
- Distance: within previous 2 km RIDB match radius
- Facility type: RIDB campground, enabled and reservable

## Baseline behavior
Before the change, RIDB matching used only facility type and proximity. A nearby but unrelated RIDB campground could confirm an EDW campground with a different name, inflating confidence and potentially making an invalid overnight stop look confirmed.

## Change made
Added conservative name-token matching in `src/services/campsiteStatusService.ts`:
- near-exact coordinate matches within 0.25 km can still match
- otherwise, a RIDB match must share at least one distinctive name token with the EDW site
- generic words such as campground, camp, area, site, rv are ignored

## Post-change behavior
`Remote Public Land Primitive Camp` does not match `Popular Lake RV Campground`; it remains unverified with the standard no-Recreation.gov-match warning.

## Campground validation results
- Remote Public Land Primitive Camp: source-backed but unconfirmed.
- Popular Lake RV Campground: valid RIDB campground, but not evidence for the EDW primitive camp.
- Confidence: improved because unrelated confirmation is blocked.

## Itinerary realism assessment
Improved. The itinerary cannot promote a primitive public-land feature to confirmed campground status solely because another campground is nearby.

## Decision
KEEP.

## Quality score
- Campground precision: improved
- Campground recall: possible small reduction where EDW/RIDB names differ substantially despite same facility
- Itinerary realism: improved
- Source confidence: improved
- User clarity: improved

## Next recommended experiment
Stop sparse-route itineraries when no verified/source-backed overnight stop exists instead of fabricating later day starts.
