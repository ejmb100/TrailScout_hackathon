import type { DaySegment, MultiDayItinerary } from '../planner';

function roundTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function hasMappedOvernightCamp(seg: DaySegment): boolean {
  return !!seg.campsite && seg.campsiteRecommendation.publicDataBacked && seg.campsiteRecommendation.officialCampingFacility;
}

export function getCampNightCoverage(
  itinerary: MultiDayItinerary | undefined,
  tripLengthDays: number
): { mapped: number; expected: number; complete: boolean } {
  const expected = Math.max(0, Math.round(tripLengthDays) - 1);
  const mapped = (itinerary?.days ?? []).filter(hasMappedOvernightCamp).length;
  return { mapped, expected, complete: mapped >= expected };
}

function segmentStartLabel(itinerary: MultiDayItinerary, seg: DaySegment): string {
  if (seg.day === 1) return 'Start';
  const previous = itinerary.days.find(d => d.day === seg.day - 1);
  return previous?.campsite ? `Night ${seg.day - 1} camp` : `Unverified Night ${seg.day - 1} stop`;
}

function segmentEndLabel(itinerary: MultiDayItinerary, seg: DaySegment): string {
  if (seg.day === itinerary.days.length) return 'Finish';
  return seg.campsite ? `Night ${seg.day} camp` : `Unverified Night ${seg.day} stop`;
}

export function buildDaySegmentLabel(itinerary: MultiDayItinerary, seg: DaySegment): string {
  const from = segmentStartLabel(itinerary, seg);
  const to = segmentEndLabel(itinerary, seg);
  return `${from} → ${to}: ${roundTenths(seg.distanceKm)} km`;
}
