/**
 * Travel logistics: nearest airports to trail regions, ground transport options,
 * and origin-city-aware recommendations for getting to the trailhead.
 */

export interface Airport {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  /** Whether this is a major hub with many direct routes. */
  hub: boolean;
}

export interface GroundTransport {
  mode: string;
  description: string;
  estimatedTime?: string;
}

export interface TravelPlan {
  originCity: string | null;
  originRegion: string | null;
  nearestAirports: { airport: Airport; distToTrailheadKm: number }[];
  groundTransport: GroundTransport[];
  notes: string[];
}

const DEG_TO_RAD = Math.PI / 180;
const R_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * sinLng * sinLng;
  return R_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Regional airports serving Colorado trail areas. */
const COLORADO_AIRPORTS: Airport[] = [
  { code: 'DRO', name: 'Durango–La Plata County Airport', city: 'Durango', lat: 37.1515, lng: -107.7538, hub: false },
  { code: 'MTJ', name: 'Montrose Regional Airport', city: 'Montrose', lat: 38.5098, lng: -107.8942, hub: false },
  { code: 'TEX', name: 'Telluride Regional Airport', city: 'Telluride', lat: 37.9538, lng: -107.9085, hub: false },
  { code: 'GUC', name: 'Gunnison–Crested Butte Regional Airport', city: 'Gunnison', lat: 38.5339, lng: -106.9332, hub: false },
  { code: 'GJT', name: 'Grand Junction Regional Airport', city: 'Grand Junction', lat: 39.1224, lng: -108.5267, hub: false },
  { code: 'ASE', name: 'Aspen/Pitkin County Airport', city: 'Aspen', lat: 39.2232, lng: -106.8688, hub: false },
  { code: 'EGE', name: 'Eagle County Regional Airport', city: 'Vail/Eagle', lat: 39.6426, lng: -106.9159, hub: false },
  { code: 'HDN', name: 'Yampa Valley Regional Airport', city: 'Steamboat Springs', lat: 40.4812, lng: -107.2177, hub: false },
  { code: 'COS', name: 'Colorado Springs Airport', city: 'Colorado Springs', lat: 38.8058, lng: -104.7009, hub: false },
  { code: 'DEN', name: 'Denver International Airport', city: 'Denver', lat: 39.8561, lng: -104.6737, hub: true },
  { code: 'ABQ', name: 'Albuquerque International Sunport', city: 'Albuquerque', lat: 35.0402, lng: -106.6092, hub: true },
  { code: 'SLC', name: 'Salt Lake City International Airport', city: 'Salt Lake City', lat: 40.7884, lng: -111.9778, hub: true },
];

/** Major US airports for departure-side recommendations + fallback for non-CO trails. */
const US_MAJOR_AIRPORTS: Airport[] = [
  // West
  { code: 'DEN', name: 'Denver International Airport', city: 'Denver', lat: 39.8561, lng: -104.6737, hub: true },
  { code: 'SLC', name: 'Salt Lake City International Airport', city: 'Salt Lake City', lat: 40.7884, lng: -111.9778, hub: true },
  { code: 'PHX', name: 'Phoenix Sky Harbor International Airport', city: 'Phoenix', lat: 33.4373, lng: -112.0078, hub: true },
  { code: 'SEA', name: 'Seattle–Tacoma International Airport', city: 'Seattle', lat: 47.4502, lng: -122.3088, hub: true },
  { code: 'SFO', name: 'San Francisco International Airport', city: 'San Francisco', lat: 37.6213, lng: -122.3790, hub: true },
  { code: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', lat: 33.9416, lng: -118.4085, hub: true },
  { code: 'PDX', name: 'Portland International Airport', city: 'Portland', lat: 45.5898, lng: -122.5951, hub: true },
  { code: 'SAN', name: 'San Diego International Airport', city: 'San Diego', lat: 32.7338, lng: -117.1933, hub: false },
  { code: 'LAS', name: 'Harry Reid International Airport', city: 'Las Vegas', lat: 36.0840, lng: -115.1537, hub: true },
  { code: 'ABQ', name: 'Albuquerque International Sunport', city: 'Albuquerque', lat: 35.0402, lng: -106.6092, hub: false },
  // Central
  { code: 'DFW', name: 'Dallas/Fort Worth International Airport', city: 'Dallas', lat: 32.8998, lng: -97.0403, hub: true },
  { code: 'IAH', name: 'George Bush Intercontinental Airport', city: 'Houston', lat: 29.9902, lng: -95.3368, hub: true },
  { code: 'MSP', name: 'Minneapolis–Saint Paul International Airport', city: 'Minneapolis', lat: 44.8848, lng: -93.2223, hub: true },
  { code: 'ORD', name: "O'Hare International Airport", city: 'Chicago', lat: 41.9742, lng: -87.9073, hub: true },
  { code: 'STL', name: 'St. Louis Lambert International Airport', city: 'St. Louis', lat: 38.7487, lng: -90.3700, hub: false },
  { code: 'MCI', name: 'Kansas City International Airport', city: 'Kansas City', lat: 39.2976, lng: -94.7139, hub: false },
  { code: 'BNA', name: 'Nashville International Airport', city: 'Nashville', lat: 36.1263, lng: -86.6774, hub: false },
  { code: 'MSY', name: 'Louis Armstrong New Orleans International Airport', city: 'New Orleans', lat: 29.9934, lng: -90.2580, hub: false },
  // Southeast
  { code: 'ATL', name: 'Hartsfield–Jackson Atlanta International Airport', city: 'Atlanta', lat: 33.6407, lng: -84.4277, hub: true },
  { code: 'MIA', name: 'Miami International Airport', city: 'Miami', lat: 25.7959, lng: -80.2870, hub: true },
  { code: 'FLL', name: 'Fort Lauderdale–Hollywood International Airport', city: 'Fort Lauderdale', lat: 26.0726, lng: -80.1527, hub: false },
  { code: 'MCO', name: 'Orlando International Airport', city: 'Orlando', lat: 28.4312, lng: -81.3081, hub: true },
  { code: 'TPA', name: 'Tampa International Airport', city: 'Tampa', lat: 27.9755, lng: -82.5332, hub: false },
  { code: 'CLT', name: 'Charlotte Douglas International Airport', city: 'Charlotte', lat: 35.2141, lng: -80.9431, hub: true },
  { code: 'RDU', name: 'Raleigh-Durham International Airport', city: 'Raleigh', lat: 35.8776, lng: -78.7875, hub: false },
  // Northeast
  { code: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', lat: 40.6413, lng: -73.7781, hub: true },
  { code: 'EWR', name: 'Newark Liberty International Airport', city: 'Newark', lat: 40.6895, lng: -74.1745, hub: true },
  { code: 'BOS', name: 'Boston Logan International Airport', city: 'Boston', lat: 42.3656, lng: -71.0096, hub: true },
  { code: 'PHL', name: 'Philadelphia International Airport', city: 'Philadelphia', lat: 39.8721, lng: -75.2411, hub: true },
  { code: 'IAD', name: 'Dulles International Airport', city: 'Washington D.C.', lat: 38.9531, lng: -77.4565, hub: true },
  { code: 'DCA', name: 'Ronald Reagan Washington National Airport', city: 'Washington D.C.', lat: 38.8512, lng: -77.0402, hub: false },
  { code: 'PIT', name: 'Pittsburgh International Airport', city: 'Pittsburgh', lat: 40.4915, lng: -80.2329, hub: false },
  // Midwest
  { code: 'DTW', name: 'Detroit Metropolitan Wayne County Airport', city: 'Detroit', lat: 42.2124, lng: -83.3534, hub: true },
  { code: 'CLE', name: 'Cleveland Hopkins International Airport', city: 'Cleveland', lat: 41.4117, lng: -81.8498, hub: false },
  { code: 'IND', name: 'Indianapolis International Airport', city: 'Indianapolis', lat: 39.7173, lng: -86.2944, hub: false },
  { code: 'CVG', name: 'Cincinnati/Northern Kentucky International Airport', city: 'Cincinnati', lat: 39.0488, lng: -84.6678, hub: false },
];

function isColoradoRegion(trailLat: number, trailLng: number): boolean {
  return trailLat >= 36.99 && trailLat <= 41.01 && trailLng >= -109.06 && trailLng <= -102.04;
}

function selectAirports(trailLat: number, trailLng: number): Airport[] {
  if (isColoradoRegion(trailLat, trailLng)) {
    return COLORADO_AIRPORTS;
  }
  return US_MAJOR_AIRPORTS;
}

function estimateDriveTime(distKm: number): string {
  const hours = distKm / 80;
  if (hours < 1) return `~${Math.round(hours * 60)} min drive`;
  return `~${hours.toFixed(1)} hr drive`;
}

function buildGroundTransport(
  nearestAirport: Airport,
  distKm: number,
  trailRegion: string,
  trailLat: number,
  trailLng: number
): GroundTransport[] {
  const transports: GroundTransport[] = [];

  transports.push({
    mode: 'Rental car',
    description: `Rent from ${nearestAirport.name} (${nearestAirport.code}). Most trailheads in ${trailRegion} require a vehicle — public transit is extremely limited.`,
    estimatedTime: estimateDriveTime(distKm),
  });

  if (distKm < 100) {
    transports.push({
      mode: 'Shuttle / rideshare',
      description: `Check for local shuttle services from ${nearestAirport.city} to popular trailheads. Seasonal shuttles may operate to high-demand areas.`,
    });
  }

  if (nearestAirport.hub && distKm > 200) {
    const regionals = COLORADO_AIRPORTS.filter(a => !a.hub && haversineKm(a.lat, a.lng, trailLat, trailLng) < distKm * 0.6);
    if (regionals.length > 0) {
      const examples = regionals.slice(0, 2).map(a => `${a.city} (${a.code})`).join(' or ');
      transports.push({
        mode: 'Regional flight + car',
        description: `Consider a connecting flight from ${nearestAirport.city} (${nearestAirport.code}) to ${examples} to cut driving time.`,
      });
    }
  }

  return transports;
}

/**
 * Build a travel logistics plan based on the user's approximate location,
 * the trail area centroid, and the region name.
 */
export function buildTravelPlan(
  userLocation: { lat: number; lng: number; city?: string; region?: string } | null,
  trailLat: number,
  trailLng: number,
  trailRegion: string
): TravelPlan {
  const airports = selectAirports(trailLat, trailLng);
  const notes: string[] = [];

  const ranked = airports
    .map(airport => ({
      airport,
      distToTrailheadKm: Math.round(haversineKm(airport.lat, airport.lng, trailLat, trailLng)),
    }))
    .sort((a, b) => a.distToTrailheadKm - b.distToTrailheadKm);

  // Take top 3 nearest + any hub not already in top 3
  const nearest = ranked.slice(0, 3);
  const hubNotInTop = ranked.find(r => r.airport.hub && !nearest.some(n => n.airport.code === r.airport.code));
  if (hubNotInTop) nearest.push(hubNotInTop);

  const primaryAirport = nearest[0];
  const groundTransport = buildGroundTransport(primaryAirport.airport, primaryAirport.distToTrailheadKm, trailRegion, trailLat, trailLng);

  const originCity = userLocation?.city ?? null;
  const originRegion = userLocation?.region ?? null;

  if (originCity) {
    const userToTrailKm = userLocation
      ? Math.round(haversineKm(userLocation.lat, userLocation.lng, trailLat, trailLng))
      : null;

    if (userToTrailKm && userToTrailKm < 300) {
      notes.push(
        `You're based near ${originCity}${originRegion ? `, ${originRegion}` : ''} — about ${userToTrailKm} km from the trail area. ` +
        `Driving directly (${estimateDriveTime(userToTrailKm)}) is likely your best option.`
      );
    } else {
      notes.push(
        `You're based near ${originCity}${originRegion ? `, ${originRegion}` : ''}, about ${userToTrailKm ?? '?'} km from the trail area. ` +
        `Flying into ${primaryAirport.airport.city} (${primaryAirport.airport.code}) is recommended.`
      );

      if (userLocation) {
        const userAirports = US_MAJOR_AIRPORTS
          .map(a => ({ ...a, dist: haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng) }))
          .sort((a, b) => a.dist - b.dist);
        const departAirport = userAirports[0];
        if (departAirport) {
          notes.push(
            `Your nearest major departure airport is ${departAirport.name} (${departAirport.code}). ` +
            `Look for flights ${departAirport.code} → ${primaryAirport.airport.code}${hubNotInTop ? ` or ${departAirport.code} → ${hubNotInTop.airport.code} with a shorter drive` : ''}.`
          );
        }
      }
    }
  } else {
    notes.push(
      `The nearest airport to ${trailRegion} is ${primaryAirport.airport.name} (${primaryAirport.airport.code}), ` +
      `about ${primaryAirport.distToTrailheadKm} km from the trail area.`
    );
  }

  if (isColoradoRegion(trailLat, trailLng)) {
    notes.push(
      'Many Colorado backcountry trailheads are on unpaved forest roads. A high-clearance vehicle (AWD/4WD) is strongly recommended, especially early in the season.'
    );
  }

  return {
    originCity,
    originRegion,
    nearestAirports: nearest,
    groundTransport,
    notes,
  };
}
