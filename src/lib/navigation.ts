import type { Locale } from "@/i18n/translations";
import { translate } from "@/i18n";

export type NavMode = "foot" | "driving";

export type RouteInfo = {
  coordinates: [number, number][]; // [lng, lat] pairs for MapLibre GeoJSON
  distance: number; // meters
  duration: number; // seconds
};

/**
 * Fetch a route from OSRM public demo server.
 * profile = "foot" uses the foot routing profile; "driving" uses driving.
 */
export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: NavMode,
): Promise<RouteInfo> {
  const profile = mode === "foot" ? "foot" : "driving";
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error("NO_ROUTE");
    return {
      coordinates: route.geometry.coordinates as [number, number][],
      distance: route.distance as number,
      duration: route.duration as number,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Format distance for display: <1000m → "xxx 米/m", >=1000m → "x.x 公里/km"
 */
export function formatDistance(meters: number, locale: Locale): string {
  if (meters < 1000) {
    return `${Math.round(meters)} ${translate(locale, "nav.m")}`;
  }
  return `${(meters / 1000).toFixed(1)} ${translate(locale, "nav.km")}`;
}

/**
 * Format duration for display: <60min → "xx 分钟/min", >=60min → "x小时h xx分钟min"
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) {
    return `${totalMin} ${translate(locale, "nav.min")}`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) {
    return `${hours} ${translate(locale, "nav.hour")}`;
  }
  return `${hours} ${translate(locale, "nav.hour")} ${mins} ${translate(locale, "nav.min")}`;
}

// ---------------------------------------------------------------------------
// Deep link URL generation for external map apps
// ---------------------------------------------------------------------------

export type MapAppLink = {
  labelKey: "nav.amap" | "nav.baidu" | "nav.appleMaps" | "nav.googleMaps";
  url: string;
};

/**
 * Generate search-based deep-link URLs for external map apps (no coordinates).
 * Used for POI lookup by name/address, e.g. restaurants.
 * URL pattern matches getDeepLinks: Amap/Google use web links, Baidu/Apple use app schemes.
 */
export function getDeepLinksBySearch(query: string): MapAppLink[] {
  const q = encodeURIComponent(query.trim());
  return [
    {
      labelKey: "nav.amap",
      url: `https://uri.amap.com/search?keyword=${q}`,
    },
    {
      labelKey: "nav.baidu",
      url: `baidumap://map/search?query=${q}`,
    },
    {
      labelKey: "nav.appleMaps",
      url: `maps://?q=${q}`,
    },
    {
      labelKey: "nav.googleMaps",
      url: `https://www.google.com/maps/search/?api=1&query=${q}`,
    },
  ];
}

/**
 * Generate deep-link URLs for various external map apps.
 * All use transit/public-transport mode by default for best urban travel.
 */
export function getDeepLinks(target: {
  lat: number;
  lng: number;
  title: string;
}): MapAppLink[] {
  const { lat, lng, title } = target;
  const encodedTitle = encodeURIComponent(title);

  return [
    {
      labelKey: "nav.amap",
      // Amap: t=1 公交, t=2 驾车, t=3 步行. Use web fallback for cross-platform.
      url: `https://uri.amap.com/navigation?to=${lng},${lat},${encodedTitle}&mode=bus`,
    },
    {
      labelKey: "nav.baidu",
      // Baidu: mode=transit 公交, driving 驾车, walking 步行
      url: `baidumap://map/direction?destination=latlng:${lat},${lng}|name:${encodedTitle}&mode=transit`,
    },
    {
      labelKey: "nav.appleMaps",
      // Apple Maps: dirflg=r transit, d=driving, w=walking
      url: `maps://?daddr=${lat},${lng}&dirflg=r`,
    },
    {
      labelKey: "nav.googleMaps",
      // Google Maps: directionsmode=transit/driving/walking
      url: `https://maps.google.com/?daddr=${lat},${lng}&directionsmode=transit`,
    },
  ];
}
