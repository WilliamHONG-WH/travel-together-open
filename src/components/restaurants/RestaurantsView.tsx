import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, MapPin, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { getLocalizedLocationName } from "@/utils/location";
import { LocationFilterModal } from "@/components/location-filter-modal";
import { RestaurantGrid } from "./RestaurantGrid";
import { RestaurantDetailModal } from "./RestaurantDetailModal";
import { RestaurantEditModal } from "./RestaurantEditModal";
import { persistRestaurant } from "./persist";
import { MEAL_TYPES, normalizeRestaurant, type MealType, type Restaurant } from "./types";

// Cast supabase to any for tables not yet in generated types
const db = supabase as any;

/** 与 LocationFilterModal / 足迹模块保持一致的哨兵值 */
const ALL = "all";

interface Props {
  tripId: string;
}

/**
 * 餐厅列表视图 — 重构自 Lovable stamp-journey dining 模块。
 * 数据与当前 tripId 绑定（trip_restaurants 表），筛选组件与足迹模块完全一致。
 */
export function RestaurantsView({ tripId }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState<MealType | null>(null);
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [cityFilter, setCityFilter] = useState<string>(ALL);
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  const [detail, setDetail] = useState<Restaurant | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Restaurant | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const fetchRestaurants = async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("trip_restaurants")
        .select("*")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRestaurants((data ?? []).map(normalizeRestaurant));
    } catch (err) {
      console.error("Error fetching restaurants:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRestaurants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // ---------------------------------------------------------------------------
  // Filters — 国家·城市联动（与足迹模块一致）+ 餐段 + 关键词
  // ---------------------------------------------------------------------------
  const countries = useMemo(
    () =>
      Array.from(new Set(restaurants.map((r) => r.country).filter(Boolean))).sort(),
    [restaurants],
  );

  const cityCountryPairs = useMemo(
    () =>
      restaurants
        .filter((r) => r.city && r.country)
        .map((r) => ({ city: r.city, country: r.country })),
    [restaurants],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants.filter((r) => {
      if (meal !== null && r.meal_type !== meal) return false;
      if (countryFilter !== ALL && r.country !== countryFilter) return false;
      if (cityFilter !== ALL && r.city !== cityFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.country.toLowerCase().includes(q) ||
        r.dishes.some((d) => d.name.toLowerCase().includes(q))
      );
    });
  }, [restaurants, meal, countryFilter, cityFilter, query]);

  // ---------------------------------------------------------------------------
  // Save / Delete — 落库链路统一走 persist.ts（上传 + 地址自动地理编码）
  // ---------------------------------------------------------------------------
  const handleSave = async (form: Restaurant, newFiles: File[]) => {
    const saved = await persistRestaurant({ tripId, form, newFiles, prev: editing });
    if (editing === null) {
      setRestaurants((prev) => [saved, ...prev]);
      toast.success(isEn ? "Restaurant added" : "餐厅添加成功");
    } else {
      setRestaurants((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      setDetail((d) => (d && d.id === saved.id ? saved : d));
      toast.success(isEn ? "Restaurant updated" : "餐厅更新成功");
    }
  };

  const handleDelete = async (r: Restaurant) => {
    const { error } = await db.from("trip_restaurants").delete().eq("id", r.id);
    if (error) throw error;
    setRestaurants((prev) => prev.filter((x) => x.id !== r.id));
    setDetail((d) => (d && d.id === r.id ? null : d));
    toast.success(isEn ? "Restaurant deleted" : "餐厅已删除");
  };

  const openCreate = () => {
    setEditing(null);
    setEditOpen(true);
  };

  const openEdit = (r: Restaurant) => {
    setDetail(null);
    setEditing(r);
    setEditOpen(true);
  };

  const locationActive = countryFilter !== ALL || cityFilter !== ALL;

  return (
    <div className="flex flex-col gap-4">
      {/* 餐段筛选药丸 — 统一扁平线条图标 */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {MEAL_TYPES.map((m) => {
          const Icon = m.icon;
          return (
            <MealPill
              key={m.id}
              active={meal === m.id}
              onClick={() => setMeal((prev) => (prev === m.id ? null : m.id))}
              isEn={isEn}
            >
              <Icon className="h-3.5 w-3.5" />
              {isEn ? m.en : m.zh}
            </MealPill>
          );
        })}
      </div>

      {/* 工具栏：搜索 + 国家·城市筛选 + 圆形纯 Icon 添加按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[140px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isEn ? "Search restaurants / dishes" : "搜索餐厅 / 菜品"}
            className="h-8 w-full rounded-full border border-border bg-card pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground transition-all focus:border-brand/50 focus:outline-none"
          />
        </div>

        {/* 国家·城市按钮 — 与足迹模块完全一致的样式与逻辑 */}
        <button
          type="button"
          onClick={() => setShowLocationFilter(true)}
          className={`h-8 px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 shrink-0 transition-all ${
            locationActive
              ? "bg-teal-50 text-teal-700 border-teal-600 dark:bg-brand/10 dark:text-brand dark:border-brand/30"
              : "bg-white border-slate-200 text-slate-800 shadow-sm hover:bg-slate-50 dark:bg-card dark:text-foreground dark:border-border dark:hover:bg-muted"
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>
            {cityFilter !== ALL
              ? getLocalizedLocationName(cityFilter, locale)
              : countryFilter !== ALL
                ? getLocalizedLocationName(countryFilter, locale)
                : isEn ? "Country · City" : "国家 · 城市"}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>

        {/* 添加餐厅 — 圆形纯 Icon 按钮（与其它模块头部 + 按钮一致） */}
        <button
          type="button"
          onClick={openCreate}
          aria-label={isEn ? "Add restaurant" : "添加餐厅"}
          title={isEn ? "Add restaurant" : "添加餐厅"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] transition-all hover:shadow-[0_0_16px_rgba(0,242,254,0.5)] active:scale-95"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
        </div>
      ) : (
        <RestaurantGrid restaurants={filtered} onSelect={setDetail} locale={locale} isEn={isEn} />
      )}

      {/* 国家·城市联动筛选弹窗 */}
      <LocationFilterModal
        isOpen={showLocationFilter}
        onClose={() => setShowLocationFilter(false)}
        countries={countries}
        cityCountryPairs={cityCountryPairs}
        selectedCountry={countryFilter}
        selectedCity={cityFilter}
        onSelect={(nextCountry, nextCity) => {
          setCountryFilter(nextCountry);
          setCityFilter(nextCity);
        }}
        formatCountry={(c) => getLocalizedLocationName(c, locale)}
        formatCity={(c) => getLocalizedLocationName(c, locale)}
        isEn={isEn}
      />

      {/* 详情弹窗 */}
      <RestaurantDetailModal
        restaurant={detail}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
        locale={locale}
        isEn={isEn}
        tripId={tripId}
      />

      {/* 新建/编辑弹窗 */}
      <RestaurantEditModal
        open={editOpen}
        initial={editing}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
        locale={locale}
        isEn={isEn}
      />
    </div>
  );
}

function MealPill({
  active,
  onClick,
  isEn: _isEn,
  children,
}: {
  active: boolean;
  onClick: () => void;
  isEn: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-brand font-semibold text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.3)]"
          : "border border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
