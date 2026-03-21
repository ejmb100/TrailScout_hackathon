/**
 * Open-Meteo forecast (free tier; verify https://open-meteo.com/en/terms for production/commercial use).
 * Browser fetch is supported (CORS enabled on api.open-meteo.com).
 */

export interface HikeForecast {
  summary: string;
  tempMaxC?: number;
  tempMinC?: number;
  precipProbMax?: number;
  /** ISO date (YYYY-MM-DD) we matched in the daily series */
  matchedDate: string;
}

function formatLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve intent `date` to a calendar day in the user's local timezone
 * so "today" / "tomorrow" match how Open-Meteo returns `daily.time` (with timezone=auto).
 */
export function resolveHikeDateLocal(dateStr: string): string {
  const now = new Date();
  const lower = dateStr.trim().toLowerCase();
  if (!lower || lower === 'today') {
    return formatLocalYMD(now);
  }
  if (lower === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return formatLocalYMD(t);
  }
  const iso = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return formatLocalYMD(now);
}

/** Short WMO Weather interpretation (Open-Meteo codes). */
function wmoLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Mixed';
}

export async function fetchForecastForHike(
  latitude: number,
  longitude: number,
  intentDate: string
): Promise<HikeForecast | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const target = resolveHikeDateLocal(intentDate);
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '16',
    timezone: 'auto',
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        time: string[];
        weathercode: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
      };
    };
    const daily = data.daily;
    if (!daily?.time?.length) return null;

    let idx = daily.time.indexOf(target);
    if (idx < 0) {
      idx = daily.time.findIndex((t) => t >= target);
      if (idx < 0) idx = daily.time.length - 1;
    }

    const tMax = daily.temperature_2m_max[idx];
    const tMin = daily.temperature_2m_min[idx];
    const code = daily.weathercode[idx];
    const precip = daily.precipitation_probability_max[idx];
    const matchedDate = daily.time[idx];

    const parts: string[] = [];
    if (Number.isFinite(code)) parts.push(wmoLabel(code));
    if (Number.isFinite(tMin) && Number.isFinite(tMax)) {
      parts.push(`${Math.round(tMin)}–${Math.round(tMax)}°C`);
    }
    if (Number.isFinite(precip)) {
      parts.push(`rain chance ${Math.round(precip)}%`);
    }

    return {
      summary: parts.join(' · ') || 'Forecast unavailable',
      tempMaxC: Number.isFinite(tMax) ? tMax : undefined,
      tempMinC: Number.isFinite(tMin) ? tMin : undefined,
      precipProbMax: Number.isFinite(precip) ? precip : undefined,
      matchedDate,
    };
  } catch {
    return null;
  }
}
