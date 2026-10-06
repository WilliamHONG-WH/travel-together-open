import { Coffee, Croissant, Utensils, Wine } from "lucide-react";

/**
 * 餐厅模块类型定义 — 重构自 Lovable stamp-journey dining 模块。
 * Emoji 图标全部替换为项目统一扁平线条图标（Lucide）。
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Dish {
  id: string;
  name: string; // 如 "Bistecca alla Fiorentina (佛罗伦萨牛排)"
  price: string; // 如 "€45 / kg"
  note: string; // 如 "招牌必点 · 推荐 3-4 分熟"
}

export interface Restaurant {
  id: string;
  trip_id: string;
  name: string;
  city: string;
  country: string;
  meal_type: MealType;
  address: string;
  hours: string;
  notes: string;
  dishes: Dish[];
  /** 攻略截图：Supabase Storage 相对路径（checkin-images bucket） */
  attachments: string[];
  /** 纬度：地址自动正向地理编码反算（null = 未解析到，地图不渲染该点位） */
  latitude: number | null;
  /** 经度：地址自动正向地理编码反算 */
  longitude: number | null;
  created_at: string;
}

/** 餐段元数据 — 统一扁平线条图标 + 项目标准 Badge 配色 */
export const MEAL_TYPES: {
  id: MealType;
  icon: typeof Coffee;
  zh: string;
  en: string;
  badgeCls: string;
}[] = [
  { id: "breakfast", icon: Croissant, zh: "早餐", en: "Breakfast", badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { id: "lunch", icon: Utensils, zh: "午餐", en: "Lunch", badgeCls: "bg-brand/10 text-brand border-brand/30" },
  { id: "dinner", icon: Wine, zh: "晚餐", en: "Dinner", badgeCls: "bg-brand/10 text-brand border-brand/30" },
  { id: "snack", icon: Coffee, zh: "下午茶", en: "Cafe & Snack", badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
];

export const mealMeta = (id: MealType) =>
  MEAL_TYPES.find((m) => m.id === id) ?? MEAL_TYPES[2];

export const uid = () => Math.random().toString(36).slice(2, 10);

/** DB 行 → Restaurant（dishes/attachments JSONB 数组规范化） */
export function normalizeRestaurant(row: any): Restaurant {
  return {
    id: row.id,
    trip_id: row.trip_id,
    name: row.name ?? "",
    city: row.city ?? "",
    country: row.country ?? "",
    meal_type: (row.meal_type as MealType) ?? "dinner",
    address: row.address ?? "",
    hours: row.hours ?? "",
    notes: row.notes ?? "",
    dishes: Array.isArray(row.dishes) ? row.dishes : [],
    attachments: Array.isArray(row.attachments) ? row.attachments.filter((p: unknown) => typeof p === "string") : [],
    latitude: typeof row.latitude === "number" && isFinite(row.latitude) ? row.latitude : null,
    longitude: typeof row.longitude === "number" && isFinite(row.longitude) ? row.longitude : null,
    created_at: row.created_at ?? "",
  };
}
