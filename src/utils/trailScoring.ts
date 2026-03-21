import { TrailData } from '../services/osmService';
import { RecommendationPreferences } from '../services/geminiService';

/**
 * Best-effort scoring utility to rank OSM trails based on user preferences.
 * Since OSM data can be sparse, this relies heavily on tag presence and basic heuristics.
 */
export function scoreAndFilterTrails(trails: TrailData[], prefs: RecommendationPreferences): TrailData[] {
  const difficultyMap = {
    beginner: ['hiking', 't1'],
    intermediate: ['mountain_hiking', 't2', 't3'],
    advanced: ['demanding_mountain_hiking', 'alpine_hiking', 't4', 't5'],
    extreme: ['demanding_alpine_hiking', 'difficult_alpine_hiking', 't6'],
  };

  const targetDifficultyTags = prefs.difficulty ? difficultyMap[prefs.difficulty] : [];
  const targetKm = prefs.maxDistance || 5;

  const scored = trails
    .map((trail) => {
      let score = 0;
      const tags = trail.tags;

      if (prefs.difficulty && tags.sac_scale) {
        if (targetDifficultyTags.some((dt) => tags.sac_scale.includes(dt))) {
          score += 30;
        } else {
          score -= 10;
        }
      } else if (prefs.difficulty === 'beginner' && (!tags.sac_scale || tags.sac_scale === 'hiking')) {
        score += 15;
      } else if (prefs.difficulty !== 'beginner' && !tags.sac_scale) {
        score -= 5;
      }

      if (prefs.terrain && prefs.terrain.length > 0 && tags.surface) {
        prefs.terrain.forEach((t) => {
          if (tags.surface?.toLowerCase().includes(t.toLowerCase())) score += 10;
        });
      }

      if (prefs.features && prefs.features.length > 0 && trail.name) {
        prefs.features.forEach((f) => {
          if (trail.name?.toLowerCase().includes(f.toLowerCase())) score += 20;
        });
      }

      if (trail.name) score += 5;

      const dist = calculateDistance(trail.path);
      const ratio = targetKm > 0 ? dist / targetKm : 0;

      if (ratio < 0.05) {
        score -= 50;
      } else if (ratio < 0.15) {
        score -= 28;
      } else if (ratio < 0.25) {
        score -= 14;
      }

      if (ratio >= 0.7 && ratio <= 1.2) {
        score += 38;
      } else if (ratio >= 0.5) {
        score += 28;
      } else if (ratio >= 0.25) {
        score += 14;
      } else if (ratio >= 0.2) {
        score += 6;
      }

      if (ratio > 1.5) {
        score -= 12;
      }

      return { trail, score, dist };
    })
    .filter((item) => item.trail.path.length >= 2)
    .sort((a, b) => b.score - a.score);

  const minFloorStrong = Math.max(1.0, 0.25 * targetKm);
  let filtered = scored.filter((s) => s.dist >= minFloorStrong);

  if (filtered.length === 0) {
    console.warn('[trailScoring] No trails above length floor; relaxing min distance filter');
    const minFloorRelaxed = Math.max(0.4, 0.08 * targetKm);
    filtered = scored.filter((s) => s.dist >= minFloorRelaxed);
  }

  if (filtered.length === 0) {
    console.warn('[trailScoring] Still empty; returning best-effort score order');
    filtered = scored;
  }

  return filtered.map((s) => s.trail);
}

/**
 * Calculates the total distance of a trail path in kilometers.
 * Uses the Haversine formula.
 */
export function calculateDistance(path: { lat: number; lng: number }[]): number {
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const degToRad = Math.PI / 180;
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * degToRad;
    const dLon = (p2.lng - p1.lng) * degToRad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * degToRad) * Math.cos(p2.lat * degToRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalDist += R * c;
  }
  return totalDist;
}
