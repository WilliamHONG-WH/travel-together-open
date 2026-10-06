import { Landmark, Utensils, Store, Sparkles, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n/translations";

export type CheckinCategory = "attraction" | "restaurant" | "shop" | "scenery";

export type CategoryConfig = {
  labelKey: TranslationKey;
  icon: LucideIcon;
  color: string; // tailwind classes for text/border/bg
  markerColor: string; // hex color for map marker dot
};

export const CHECKIN_CATEGORIES: Record<CheckinCategory, CategoryConfig> = {
  attraction: {
    labelKey: "category_attraction",
    icon: Landmark,
    color: "text-amber-500 border-amber-500/30 bg-amber-500/10",
    markerColor: "#f59e0b",
  },
  restaurant: {
    labelKey: "category_restaurant",
    icon: Utensils,
    color: "text-rose-500 border-rose-500/30 bg-rose-500/10",
    markerColor: "#f43f5e",
  },
  shop: {
    labelKey: "category_shop",
    icon: Store,
    color: "text-blue-500 border-blue-500/30 bg-blue-500/10",
    markerColor: "#3b82f6",
  },
  scenery: {
    labelKey: "category_scenery",
    icon: Sparkles,
    color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
    markerColor: "#10b981",
  },
};

export const DEFAULT_CATEGORY: CheckinCategory = "attraction";

export function getCategoryConfig(category?: string | null): CategoryConfig {
  if (category && category in CHECKIN_CATEGORIES) {
    return CHECKIN_CATEGORIES[category as CheckinCategory];
  }
  return CHECKIN_CATEGORIES[DEFAULT_CATEGORY];
}
