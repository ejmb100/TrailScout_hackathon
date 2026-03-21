import { TrailData } from '../services/osmService';
import { RecommendationPreferences } from '../services/geminiService';

/**
 * Best-effort scoring utility to rank OSM trails based on user preferences.
 * Since OSM data can be sparse, this relies heavily on tag presence and basic heuristics.
 */
export function scoreAndFilterTrails(trails: TrailData[], prefs: RecommendationPreferences): TrailData[] {
  // Map of difficulty to sac_scale tags
  const difficultyMap = {
    beginner: ['hiking', 't1'],
    intermediate: ['mountain_hiking', 't2', 't3'],
    advanced: ['demanding_mountain_hiking', 'alpine_hiking', 't4', 't5'],
    extreme: ['demanding_alpine_hiking', 'difficult_alpine_hiking', 't6']
  };

  const targetDifficultyTags = prefs.difficulty ? difficultyMap[prefs.difficulty] : [];
  const targetKm = (prefs.maxDistance || 5); // Default to 5km if mission not specified

  return trails
    .map(trail => {
      let score = 0;
      const tags = trail.tags;

      // 1. Difficulty matching
      if (prefs.difficulty && tags.sac_scale) {
        if (targetDifficultyTags.some(dt => tags.sac_scale.includes(dt))) {
          score += 30; // Strong match for difficulty
        } else {
          score -= 10; // Penalty for mismatch
        }
      } else if (prefs.difficulty === 'beginner' && (!tags.sac_scale || tags.sac_scale === 'hiking')) {
        score += 15; // Assumption is unrated is probably easy, but less weight
      } else if (prefs.difficulty !== 'beginner' && !tags.sac_scale) {
        // Advanced hikers want properly tagged trails
        score -= 5;
      }

      // 2. Surface matching (approximate)
      if (prefs.terrain && prefs.terrain.length > 0 && tags.surface) {
        prefs.terrain.forEach(t => {
          if (tags.surface?.toLowerCase().includes(t.toLowerCase())) score += 10;
        });
      }

      // 3. Name matching (looking for features in trail name as a fallback)
      if (prefs.features && prefs.features.length > 0 && trail.name) {
        prefs.features.forEach(f => {
          if (trail.name?.toLowerCase().includes(f.toLowerCase())) score += 20;
        });
      }

      // 4. Data Quality bonus (trails with names are generally better)
      if (trail.name) score += 5;
      
      // 5. Length Matching (Distance based)
      const dist = calculateDistance(trail.path);
      
      // Preference for trails that are at least 15% of the intended total length
      // This prevents tiny fragments from cluttering the results.
      if (dist < targetKm * 0.05) {
        score -= 40; // Heavy penalty for tiny fragments
      } else if (dist >= targetKm * 0.5) {
        score += 30; // Strong bonus for trails that cover a lot of the desired distance
      } else if (dist >= targetKm * 0.2) {
        score += 15;
      }

      return { trail, score };
    })
    // Filter out completely invalid paths
    .filter(item => item.trail.path.length >= 2)
    // Sort descending by score
    .sort((a, b) => b.score - a.score)
    // Map back to TrailData
    .map(item => item.trail);
}

/**
 * Calculates the total distance of a trail path in kilometers.
 * Uses the Haversine formula.
 */
export function calculateDistance(path: { lat: number, lng: number }[]): number {
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i+1];
    const degToRad = Math.PI / 180;
    const R = 6371; // Earth's radius in km
    const dLat = (p2.lat - p1.lat) * degToRad;
    const dLon = (p2.lng - p1.lng) * degToRad;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(p1.lat * degToRad) * Math.cos(p2.lat * degToRad) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    totalDist += R * c;
  }
  return totalDist;
}
