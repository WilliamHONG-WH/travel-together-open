import type { Checkin } from "@/lib/checkins";
import type { Locale } from "@/i18n/translations";

export type DayGroup = {
  key: string; // YYYY-MM-DD
  dayIndex: number; // 1-based, oldest = 1
  dateLabel: string; // YYYY-MM-DD
  weekday: string; // localized weekday label
  items: Checkin[]; // desc by created_at within day
};

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Groups checkins by local day, newest day first. Day index counts from earliest = 1. */
export function groupCheckinsByDay(
  checkins: Checkin[],
  locale: Locale = "zh",
): DayGroup[] {
  if (checkins.length === 0) return [];
  const weekdays = locale === "zh" ? WEEKDAYS_ZH : WEEKDAYS_EN;
  const byKey = new Map<string, Checkin[]>();
  for (const c of checkins) {
    const k = dayKey(c.created_at);
    const arr = byKey.get(k) ?? [];
    arr.push(c);
    byKey.set(k, arr);
  }
  const keysAsc = [...byKey.keys()].sort();
  const indexOf = new Map<string, number>();
  keysAsc.forEach((k, i) => indexOf.set(k, i + 1));

  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => {
      items.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const d = new Date(items[0].created_at);
      return {
        key,
        dayIndex: indexOf.get(key)!,
        dateLabel: key,
        weekday: weekdays[d.getDay()],
        items,
      };
    });
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// City grouping — 按城市分组
// ---------------------------------------------------------------------------

export type CityGroup = {
  key: string; // city name
  cityName: string;
  total: number;
  items: Checkin[]; // desc by created_at within city
};

/** Groups checkins by city. Items without city go to "未定位"/"Unlocated". */
export function groupCheckinsByCity(
  checkins: Checkin[],
  locale: Locale = "zh",
): CityGroup[] {
  if (checkins.length === 0) return [];
  const unlocatedLabel = locale === "zh" ? "未定位" : "Unlocated";
  const byCity = new Map<string, Checkin[]>();
  for (const c of checkins) {
    const k = c.city || unlocatedLabel;
    const arr = byCity.get(k) ?? [];
    arr.push(c);
    byCity.set(k, arr);
  }
  return [...byCity.entries()]
    .map(([key, items]) => {
      items.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      return {
        key,
        cityName: key,
        total: items.length,
        items,
      };
    })
    .sort((a, b) => b.total - a.total); // cities with most checkins first
}
