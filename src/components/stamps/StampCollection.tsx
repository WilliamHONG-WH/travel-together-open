import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, ChevronDown, MapPin, Landmark, Leaf, Soup, Grid3x3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, useT } from "@/i18n";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { USER_STAMPS_KEY, userStampsQueryOptions, type Checkin } from "@/lib/user-stamps";
import type { StampEntry, StampCategory } from "./types";
import { mapCheckinCategory, getCategoryIcon, getCategoryAccent, CITY_COUNTRY_MAP, getEffectiveCountry } from "./types";
import { StampCard } from "./StampCard";
import { PassportBook } from "./PassportBook";
import { DetailModal } from "./DetailModal";
import { StampSheetModal } from "./StampSheetModal";
import { LocationFilterModal } from "@/components/location-filter-modal";
import { getLocalizedLocationName } from "@/utils/location";
import { CachedImage } from "@/components/signed-image";

interface Props {
  tripId: string;
  /** 当前行程名称 (用于明信片顶部副标题与导出文件名) */
  tripName?: string;
}

// 哨兵值与 LocationFilterModal 的 ALL = "all" 保持一致，
// 避免弹窗返回 "all" 而本地比对 "__all__" 导致筛选误判为无匹配
const ALL_OPTION = "all";

function toStampEntry(
  row: Checkin,
  memberMap: Map<string, { name: string; avatar_url: string | null }>
): StampEntry {
  const safeCategory = mapCheckinCategory(row.category || "cities");
  const creator = memberMap.get(row.user_id) ?? { name: "User", avatar_url: null };
  const effectiveCountry = getEffectiveCountry(row.city ?? "", row.country ?? undefined);
  return {
    id: row.id,
    title: row.title || row.city || "Untitled",
    iconCode: getCategoryIcon(row.category),
    // 原样透传真实打卡图片 URL (http/Base64/Storage 路径)，
    // 空值由 StampCard 渲染渐变占位，严禁硬编码 Unsplash 替代图
    photo: row.image_url ?? "",
    location: row.city || "Unknown",
    city: row.city || "Unknown",
    country: effectiveCountry,
    category: safeCategory,
    description: row.note || row.title || "",
    accent: getCategoryAccent(row.category),
    creator: {
      name: creator.name,
      color: "bg-brand",
      avatar_url: creator.avatar_url,
      userId: row.user_id,
    },
    createdAt: row.created_at,
    note: row.note || "",
    isFeatured: false,
  };
}

// 分类筛选选项 (静态定义，组件外引用以避免 temporal dead zone)
// 纯 Icon 按钮 + 专属点亮色彩 (与 StampCard 分类徽章保持一致)
const catOptions: {
  key: StampCategory;
  labelKey: string;
  Icon: typeof Landmark;
  activeClass: string;
}[] = [
  {
    key: "cities",
    labelKey: "category_cities",
    Icon: Landmark,
    activeClass:
      "bg-teal-600 text-white border-teal-600 shadow-sm dark:bg-teal-500 dark:text-slate-950 dark:border-teal-500",
  },
  {
    key: "nature",
    labelKey: "category_nature",
    Icon: Leaf,
    activeClass:
      "bg-emerald-600 text-white border-emerald-600 shadow-sm dark:bg-emerald-500 dark:text-slate-950 dark:border-emerald-500",
  },
  {
    key: "food",
    labelKey: "category_food",
    Icon: Soup,
    activeClass:
      "bg-orange-500 text-white border-orange-500 shadow-sm dark:bg-orange-400 dark:text-slate-950 dark:border-orange-400",
  },
];

export function StampCollection({ tripId, tripName }: Props) {
  const { locale } = useI18n();
  const t = useT();
  const isEn = locale === "en";
  const queryClient = useQueryClient();

  // 统一使用 userStampsQueryOptions：与 Map Tab 共享同一缓存键，
  // 切换 Tab 时直接渲染缓存数据 (0ms 秒开)，后台静默刷新
  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery(userStampsQueryOptions(tripId));
  const { data: members = [] } = useQuery(tripMembersQueryOptions(tripId));

  // ─── 星标持久化：从数据库同步 is_featured 到本地 featuredIds ───
  // 页面初次加载 / 重新进入 / refetch 后，根据 rows 中的 is_featured 字段
  // 重建 featuredIds Set，确保星标状态从 DB 恢复而非永远为空
  useEffect(() => {
    if (!rows.length) return;
    setFeaturedIds((prev) => {
      const next = new Set<string>();
      rows.forEach((r: Checkin) => {
        if (r.is_featured) next.add(r.id);
      });
      // 仅在 DB 状态与本地不一致时更新，避免覆盖乐观更新
      const prevStr = Array.from(prev).sort().join(",");
      const nextStr = Array.from(next).sort().join(",");
      return prevStr === nextStr ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; avatar_url: string | null }>();
    members.forEach((m) =>
      map.set(m.user_id, {
        name: m.display_name || "User",
        avatar_url: m.avatar_url,
      })
    );
    return map;
  }, [members]);

  const [view, setView] = useState<"feed" | "book">("feed");
  // 分类筛选：多选数组，全未选或全选时均视为不限制分类
  const [selectedCategories, setSelectedCategories] = useState<StampCategory[]>([]);
  const [countryFilter, setCountryFilter] = useState<string>(ALL_OPTION);
  const [cityFilter, setCityFilter] = useState<string>(ALL_OPTION);
  const [travelerFilter, setTravelerFilter] = useState<string>(ALL_OPTION);
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(new Set());
  const [openEntry, setOpenEntry] = useState<StampEntry | null>(null);
  // 国家·城市联动筛选弹窗
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  // 精选邮票明信片导出弹窗
  const [showSheetExport, setShowSheetExport] = useState(false);

  const stamps = useMemo(() => {
    const base = rows.map((r: Checkin) => toStampEntry(r, memberMap));
    return base.map((s: StampEntry) => ({ ...s, isFeatured: featuredIds.has(s.id) }));
  }, [rows, memberMap, featuredIds]);

  const travelers = useMemo(() => {
    return members.map((m) => ({
      id: m.user_id,
      name: m.display_name || "User",
      color: "bg-brand",
      avatar_url: m.avatar_url,
    }));
  }, [members]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    stamps.forEach((s) => {
      if (s.country) set.add(s.country);
    });
    return Array.from(set).sort();
  }, [stamps]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    stamps.forEach((s) => {
      if (s.city && (countryFilter === ALL_OPTION || s.country === countryFilter)) {
        set.add(s.city);
      }
    });
    return Array.from(set).sort();
  }, [stamps, countryFilter]);

  // 完整的城市→国家映射 (供 LocationFilterModal 联动使用，不受当前筛选限制)
  const cityCountryPairs = useMemo(
    () =>
      stamps
        .filter((s) => s.city && s.country)
        .map((s) => ({ city: s.city, country: s.country })),
    [stamps],
  );

  const filtered = useMemo(() => {
    return stamps.filter((s: StampEntry) => {
      // 1. 分类匹配：全未选 (0) 或全选 (3) 时视为不限制分类
      const categoryMatch =
        selectedCategories.length === 0 ||
        selectedCategories.length === catOptions.length ||
        selectedCategories.includes(s.category);
      if (!categoryMatch) return false;

      // 2. 国家/城市地点筛选：未选择、为空或为 'all' 时默认放行全部
      const isNoLocationFilter = !countryFilter || !cityFilter;
      const countryMatch =
        !countryFilter || countryFilter === ALL_OPTION || s.country === countryFilter;
      const cityMatch =
        !cityFilter || cityFilter === ALL_OPTION || s.city === cityFilter;
      if (!isNoLocationFilter && !(countryMatch && cityMatch)) return false;

      // 3. 旅行者匹配
      if (travelerFilter !== ALL_OPTION && s.creator.name !== travelerFilter) return false;
      return true;
    });
  }, [stamps, selectedCategories, countryFilter, cityFilter, travelerFilter, catOptions.length]);

  const featured = useMemo(() => stamps.filter((s: StampEntry) => s.isFeatured), [stamps]);

  // 导出取票策略：有星标/精选 → 仅精选；无星标 → 全量邮票
  const exportStamps = featured.length > 0 ? featured : stamps;

  const toggleFeatured = async (id: string) => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return;
    const currentFeatured = featuredIds.has(id);
    const newFeatured = !currentFeatured;

    setFeaturedIds((prev) => {
      const next = new Set(prev);
      if (newFeatured) next.add(id);
      else next.delete(id);
      return next;
    });

    try {
      const { error } = await (supabase as any)
        .from("user_stamps")
        .update({ is_featured: newFeatured })
        .eq("id", id);

      if (error) {
        throw error;
      }

      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
    } catch (err) {
      console.error("Failed to update featured status:", err);

      setFeaturedIds((prev) => {
        const next = new Set(prev);
        if (currentFeatured) next.add(id);
        else next.delete(id);
        return next;
      });

      alert("Failed to update featured status. Please try again.");
    }
  };

  const saveNote = async (id: string, note: string) => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return;
    await (supabase as any).from("user_stamps").update({ notes: note }).eq("id", id);
    await (supabase as any).from("checkins").update({ note }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
  };

  const handleStampDeleted = useCallback((deletedId: string) => {
    setOpenEntry(null);
    setFeaturedIds((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });
    }, 100);
  }, [queryClient, tripId]);

  return (
    <div className="mt-4">
      {/* 顶栏导航：导航胶囊 (左) + 打卡人头像 (右) 同行两端对齐 */}
      <div className="flex items-center justify-between w-full mb-3 px-0.5">
        {/* 左侧：适应宽度的 Feed/Collections 视图切换胶囊 (不撑满全行) */}
        <div className="inline-flex items-center p-1 rounded-full border bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setView("feed")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              view === "feed"
                ? "bg-teal-50 border border-teal-500/30 text-teal-600 dark:bg-cyan-950/40 dark:border-cyan-400 dark:text-cyan-400 dark:shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 bg-transparent border-transparent"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>{isEn ? "Feed" : "动态"}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("book")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
              view === "book"
                ? "bg-teal-50 border border-teal-500/30 text-teal-600 dark:bg-cyan-950/40 dark:border-cyan-400 dark:text-cyan-400 dark:shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 bg-transparent border-transparent"
            }`}
          >
            <Grid3x3 className="h-3.5 w-3.5" />
            <span>{isEn ? "Collections" : "展示墙"}</span>
          </button>
        </div>

        {/* 右侧：同行靠右的打卡人头像组 (顶边与左侧胶囊平齐) */}
        {travelers.length > 0 && (
          <div className="flex -space-x-2 overflow-hidden">
            {travelers.slice(0, 5).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTravelerFilter(travelerFilter === t.name ? ALL_OPTION : t.name)}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-brand-foreground ring-2 ring-background transition-opacity ${
                  travelerFilter !== ALL_OPTION && travelerFilter !== t.name
                    ? "opacity-30"
                    : "opacity-100"
                } ${t.color}`}
                title={t.name}
              >
                {t.avatar_url ? (
                  <CachedImage value={t.avatar_url} bucket="avatars" alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  t.name.charAt(0)
                )}
              </button>
            ))}
            {travelers.length > 5 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                +{travelers.length - 5}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 第二行：分类 Icon (左) + 国家·城市 (右) */}
      <div className="flex items-center justify-between gap-2 h-11 my-3 px-1">
        {/* 左侧：分类一组 (城市 / 自然 / 美食) 纯 Icon 按钮 */}
        <div className="flex items-center gap-1.5 p-1 bg-white dark:bg-muted/80 border border-slate-200 dark:border-border rounded-full shadow-sm">
          {catOptions.map(({ key, Icon, activeClass }) => {
            const isActive = selectedCategories.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setSelectedCategories((prev) =>
                    isActive
                      ? prev.filter((k) => k !== key)
                      : [...prev, key],
                  )
                }
                className={`flex h-7 w-8 items-center justify-center rounded-full border transition-all active:scale-95 ${
                  isActive ? activeClass : "border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-800 dark:hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {/* 右侧：国家·城市按钮 */}
        <button
          onClick={() => setShowLocationFilter(true)}
          className={`h-8 px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 shrink-0 transition-all ${
            (countryFilter && countryFilter !== ALL_OPTION) ||
            (cityFilter && cityFilter !== ALL_OPTION)
              ? "bg-teal-50 text-teal-700 border-teal-600 dark:bg-brand/10 dark:text-brand dark:border-brand/30"
              : "bg-white border-slate-200 text-slate-800 shadow-sm hover:bg-slate-50 dark:bg-card dark:text-foreground dark:border-border dark:hover:bg-muted"
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>
            {cityFilter && cityFilter !== ALL_OPTION
              ? getLocalizedLocationName(cityFilter, locale)
              : countryFilter && countryFilter !== ALL_OPTION
                ? getLocalizedLocationName(countryFilter, locale)
                : isEn ? "Country · City" : "国家 · 城市"}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

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

      {/* Loading / Error states */}
      {isLoading && (
        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm text-muted-foreground">{isEn ? "Loading footprints…" : "加载足迹中…"}</p>
        </div>
      )}
      {error && !isLoading && (
        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-rose-400">
            {isEn ? "Failed to load footprints." : "加载足迹失败。"}
          </p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) })}
            className="mt-3 rounded-full bg-brand/15 px-4 py-1.5 text-xs font-medium text-brand border border-brand/40 transition hover:bg-brand/20"
          >
            {isEn ? "Retry" : "重试"}
          </button>
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && (
        <>
          {view === "feed" ? (
            <div className="grid grid-cols-3 gap-4 w-full my-3 px-1 items-start">
              {filtered.map((s: StampEntry) => (
                <StampCard
                  key={s.id}
                  entry={s}
                  onClick={() => setOpenEntry(s)}
                  onToggleFeatured={toggleFeatured}
                />
              ))}
            </div>
          ) : (
            <PassportBook
              featured={featured}
              onSelect={setOpenEntry}
              onExport={() => setShowSheetExport(true)}
              emptyLabel={
                isEn
                  ? "No featured stamps yet. Tap the ⭐ on any footprint in Feed view to paste it into your passport."
                  : "暂无精选邮票。在动态视图中点击任意足迹的 ⭐ 将其收入护照本。"
              }
            />
          )}

          {filtered.length === 0 && stamps.length === 0 && (
            <div className="mt-10 flex flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted border border-border">
                <LayoutGrid className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {isEn
                  ? "No footprints yet. Check in on the map to create your first stamp!"
                  : "暂无足迹。在地图上打卡创建你的第一张邮票！"}
              </p>
            </div>
          )}
        </>
      )}

      {openEntry && (
        <DetailModal
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
          onDeleteSuccess={handleStampDeleted}
          tripId={tripId}
        />
      )}

      {/* 精选邮票明信片导出弹窗 (6:4 Canvas 拼图) */}
      {showSheetExport && (
        <StampSheetModal
          open={showSheetExport}
          onClose={() => setShowSheetExport(false)}
          stamps={exportStamps}
          tripName={tripName || ""}
        />
      )}
    </div>
  );
}
