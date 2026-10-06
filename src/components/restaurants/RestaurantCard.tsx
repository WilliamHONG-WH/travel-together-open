import { MapPin, Paperclip, Utensils } from "lucide-react";
import type { Restaurant } from "./types";
import { mealMeta } from "./types";
import { getLocalizedLocationName } from "@/utils/location";

interface Props {
  restaurant: Restaurant;
  onClick: () => void;
  locale: string;
  isEn: boolean;
}

export function RestaurantCard({ restaurant, onClick, locale, isEn }: Props) {
  const meal = mealMeta(restaurant.meal_type);
  const MealIcon = meal.icon;
  const highlights = restaurant.dishes
    .slice(0, 2)
    .map((d) => d.name.replace(/\s*\(.*?\)\s*/g, "").trim())
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col items-start gap-2 rounded-2xl border border-border/80 bg-card p-4 text-left shadow-sm transition-all hover:border-brand/40 active:scale-[0.99]"
    >
      <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold font-mono ${meal.badgeCls}`}>
        <MealIcon className="w-3.5 h-3.5" />
        {isEn ? meal.en : meal.zh}
      </span>

      <h3 className="text-base font-bold text-foreground transition-colors group-hover:text-brand">
        {restaurant.name || (isEn ? "Unnamed" : "未命名")}
      </h3>

      {(restaurant.city || restaurant.country) && (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 text-brand" />
          {[
            getLocalizedLocationName(restaurant.city || "", locale),
            getLocalizedLocationName(restaurant.country || "", locale),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {highlights && (
        <p className="line-clamp-2 inline-flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Utensils className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <span>
            <span className="text-muted-foreground/70">{isEn ? "Must-order: " : "必点: "}</span>
            {highlights}
          </span>
        </p>
      )}

      {restaurant.attachments.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          {restaurant.attachments.length} {isEn ? (restaurant.attachments.length > 1 ? "screenshots" : "screenshot") : "张攻略"}
        </span>
      )}
    </button>
  );
}
