import type { Restaurant } from "./types";
import { RestaurantCard } from "./RestaurantCard";

interface Props {
  restaurants: Restaurant[];
  onSelect: (r: Restaurant) => void;
  locale: string;
  isEn: boolean;
}

export function RestaurantGrid({ restaurants, onSelect, locale, isEn }: Props) {
  if (restaurants.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <p className="text-sm font-semibold text-foreground">
          {isEn ? "No matching restaurants" : "没有匹配的餐厅"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isEn
            ? "Try changing meal type, location, or clearing the search."
            : "换个餐段、城市，或清空搜索关键词试试。"}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {restaurants.map((r) => (
        <RestaurantCard key={r.id} restaurant={r} onClick={() => onSelect(r)} locale={locale} isEn={isEn} />
      ))}
    </div>
  );
}
