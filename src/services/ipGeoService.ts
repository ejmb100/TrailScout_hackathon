/**
 * Approximate client location from IP (HTTPS). Coarse; wrong on VPNs / corporate networks.
 * ipapi.co: no key for light use; optional token in URL if you add VITE_IPAPI_TOKEN later.
 */

export interface ApproxIpLocation {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
}

export async function fetchApproxIpLocation(): Promise<ApproxIpLocation | null> {
  const token = import.meta.env.VITE_IPAPI_TOKEN;
  const url = token
    ? `https://ipapi.co/json/?key=${encodeURIComponent(token)}`
    : 'https://ipapi.co/json/';

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      error?: boolean;
      reason?: string;
    };
    if (data.error || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
      return null;
    }
    return {
      lat: data.latitude!,
      lng: data.longitude!,
      city: data.city,
      region: data.region,
    };
  } catch {
    return null;
  }
}
