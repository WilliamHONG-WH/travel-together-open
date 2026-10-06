import { useMemo, useState, useEffect, useCallback } from "react";
import { MapPin, BedDouble, Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Hotel } from "./hotelData";
import { mapRowToHotel, formatStayDates, HOTEL_SELECT } from "./hotelData";
import { HotelEditModal } from "./HotelEditModal";
import { LocationFilterModal } from "@/components/location-filter-modal";
import { useI18n } from "@/i18n";
import {
  getLocalizedCountry,
  getLocalizedCity,
} from "@/constants/locations";
import { geocodeVenue } from "@/lib/geocode";
import { PhotoImage } from "@/components/signed-image";

const STORAGE_KEY = "hotels:list";

function loadFromLocal(tripId: string): Hotel[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${tripId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Hotel[];
  } catch {
    return null;
  }
}

function saveToLocal(tripId: string, list: Hotel[]) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${tripId}`, JSON.stringify(list));
  } catch (err) {
    console.warn("localStorage save failed:", err);
  }
}

/**
 * 酒店（Hotels）列表 — 卡片网格 1:1 对齐百科卡片样式：
 * 上半部分封面图，下半部分三行文字
 * （名称 / 城市, 国家 / 入住周期）。
 */
export function HotelsPanel({ tripId }: { tripId: string }) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [hotels, setHotels] = useState<Hotel[]>(() => loadFromLocal(tripId) ?? []);
  const [country, setCountry] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  const [loading, setLoading] = useState(!loadFromLocal(tripId));

  // 带条件拉取：必须传入当前 tripId，强制按行程隔离
  const fetchHotels = useCallback(async (silent = false) => {
    if (!tripId) return;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("hotels")
        .select(HOTEL_SELECT)
        .eq("trip_id", tripId)
        // 与百科一致：城市名 A-Z 为主，创建时间降序为次（同城卡片聚集排列）
        .order("city", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(100);

      if (!error && data) {
        const mapped = (data as any[]).map(mapRowToHotel);
        setHotels(mapped);
        saveToLocal(tripId, mapped);
      } else if (error) {
        console.warn("Supabase hotels fetch failed, fallback to local:", error);
      }
    } catch (err) {
      console.warn("Hotels fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (tripId) {
      const local = loadFromLocal(tripId);
      if (!local) {
        fetchHotels(false);
      } else {
        setHotels(local);
        setLoading(false);
        void fetchHotels(true);
      }
    } else {
      setHotels([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // Realtime：酒店增删改后自动重拉
  useEffect(() => {
    const channel = (supabase as any)
      .channel(`hotels-list:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hotels",
          filter: `trip_id=eq.${tripId}`,
        },
        () => fetchHotels(true),
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [tripId, fetchHotels]);

  const countries = useMemo(
    () => Array.from(new Set(hotels.map((h) => h.country))).filter(Boolean).sort(),
    [hotels],
  );
  const cities = useMemo(
    () =>
      Array.from(
        new Set(
          hotels
            .filter((h) => country === "all" || h.country === country)
            .map((h) => h.city),
        ),
      ).filter(Boolean).sort(),
    [hotels, country],
  );

  // 完整的城市→国家映射（供 LocationFilterModal 联动使用）
  const cityCountryPairs = useMemo(
    () =>
      hotels
        .filter((h) => h.city && h.country)
        .map((h) => ({ city: h.city, country: h.country })),
    [hotels],
  );

  const visible = useMemo(
    () =>
      hotels
        .filter((h) => {
          const isNoLocationFilter = !country || !city;
          const countryMatch = !country || country === "all" || h.country === country;
          const cityMatch = !city || city === "all" || h.city === city;
          if (!isNoLocationFilter && !(countryMatch && cityMatch)) return false;
          return true;
        })
        // 客户端兜底排序（与 Supabase 查询排序保持一致）
        .slice()
        .sort((a, b) => {
          const cityA = (a.city || "").toLowerCase();
          const cityB = (b.city || "").toLowerCase();
          if (cityA < cityB) return -1;
          if (cityA > cityB) return 1;
          return (b.createdAt || "").localeCompare(a.createdAt || "");
        }),
    [hotels, country, city],
  );

  const active = openId ? hotels.find((h) => h.id === openId) ?? null : null;

  /** 保存酒店（新建 insert / 更新 update）— 名称/地址/城市变化或坐标缺失时自动正向地理编码 */
  const saveHotel = async (updated: Hotel) => {
    const isNew = !hotels.some((h) => h.id === updated.id);
    if (!isNew && !updated.id) return;

    const safeName = updated.name?.trim() || "";
    const safeHotel: Hotel = {
      ...updated,
      id: isNew && !updated.id ? crypto.randomUUID() : updated.id,
      name: safeName,
    };
    if (!safeName) {
      toast.error(isEn ? "Please enter the hotel name" : "请输入酒店名称");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 自动正向地理编码：新建 / 名称·地址·城市变化 / 坐标缺失
      const prev = hotels.find((h) => h.id === updated.id);
      const geoChanged =
        !!prev &&
        (prev.address !== safeHotel.address ||
          prev.city !== safeHotel.city ||
          prev.country !== safeHotel.country ||
          prev.name !== safeHotel.name);
      const needGeo =
        isNew || geoChanged || safeHotel.latitude == null || safeHotel.longitude == null;
      let latitude = safeHotel.latitude;
      let longitude = safeHotel.longitude;
      if (needGeo) {
        const geo = await geocodeVenue({
          name: safeHotel.name,
          address: safeHotel.address,
          cityKey: safeHotel.city,
          countryKey: safeHotel.country,
        });
        if (geo) {
          latitude = geo.lat;
          longitude = geo.lng;
        }
      }

      const payload = {
        trip_id: tripId,
        user_id: user.id,
        name: safeName,
        city: safeHotel.city || "",
        country: safeHotel.country || "",
        address: safeHotel.address || "",
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        check_in_date: safeHotel.checkInDate || null,
        check_out_date: safeHotel.checkOutDate || null,
        notes: safeHotel.notes || "",
        cover_image_url: safeHotel.cover || "",
        updated_at: new Date().toISOString(),
      };

      if (isNew) {
        const { data, error } = await (supabase as any)
          .from("hotels")
          .insert({ ...payload, id: safeHotel.id })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        if (!data || !data.id) {
          throw new Error(isEn ? "Insert succeeded but no id returned" : "插入成功但未返回 id");
        }
        const newHotel = { ...safeHotel, latitude, longitude };
        setHotels((prev) => [newHotel, ...prev]);
        saveToLocal(tripId, [newHotel, ...hotels]);
        toast.success(isEn ? "Hotel created" : "酒店已创建");
      } else {
        const { error } = await (supabase as any)
          .from("hotels")
          .update(payload)
          .eq("id", updated.id);
        if (error) throw new Error(error.message);
        setHotels((prev) =>
          prev.map((h) => (h.id === updated.id ? { ...safeHotel, latitude, longitude } : h)),
        );
        saveToLocal(tripId, hotels.map((h) => (h.id === updated.id ? { ...safeHotel, latitude, longitude } : h)));
        toast.success(isEn ? "Hotel updated" : "酒店已更新");
      }

      await fetchHotels(true);
    } catch (dbErr: any) {
      console.error("Supabase hotels sync failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database write error" : "数据库写入异常");
      toast.error(isEn ? `Failed to save: ${reason}` : `酒店保存失败: ${reason}`);
      return;
    }

    setOpenId(null);
    setIsNewModalOpen(false);
  };

  /** 删除酒店：从 Supabase 删除后强制 refetch，返回是否成功 */
  const deleteHotel = async (id: string): Promise<boolean> => {
    if (!id) return false;
    try {
      const { error } = await (supabase as any).from("hotels").delete().eq("id", id);
      if (error) throw error;
      setHotels((prev) => {
        const next = prev.filter((h) => h.id !== id);
        saveToLocal(tripId, next);
        return next;
      });
      toast.success(isEn ? "Hotel deleted" : "酒店已删除");
      await fetchHotels(true);
      return true;
    } catch (dbErr: any) {
      console.error("Supabase hotels delete failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database delete error" : "数据库删除异常");
      toast.error(isEn ? `Failed to delete: ${reason}` : `删除失败: ${reason}`);
      return false;
    }
  };

  const activeFilters =
    (country && country !== "all" ? 1 : 0) + (city && city !== "all" ? 1 : 0);

  // 新建模式空草稿 — 每次打开重新生成 UUID，与编辑模式共用同一套 ID/Storage 写入链路
  const [newHotelId, setNewHotelId] = useState(() => crypto.randomUUID());
  const newHotelDraft = useMemo<Hotel>(
    () => ({
      id: newHotelId,
      name: "",
      city: "",
      country: "",
      address: "",
      checkInDate: "",
      checkOutDate: "",
      notes: "",
      cover: "",
    }),
    [newHotelId],
  );

  return (
    <div className="mt-4">
      {/* 顶部筛选与新建工具栏 — 全模块统一 h-11 固定高度，消除 Tab 切换抖动 */}
      <div className="flex items-center justify-between gap-2 h-11 my-3 px-1">
        {/* 左侧：国家·城市合并下拉按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLocationFilter(true)}
            className={`h-8 px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 shrink-0 transition-all ${
              activeFilters > 0
                ? "bg-brand/10 text-brand border-brand/30"
                : "bg-muted/90 text-foreground border-border/80 hover:bg-muted"
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>
              {city && city !== "all"
                ? getLocalizedCity(city, locale, country === "all" || !country ? undefined : country)
                : country && country !== "all"
                  ? getLocalizedCountry(country, locale)
                  : isEn ? "Country · City" : "国家 · 城市"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* 右侧：新建按钮 — 全模块统一 w-10 h-10 shrink-0 */}
        <button
          onClick={() => {
            setNewHotelId(crypto.randomUUID());
            setIsNewModalOpen(true);
          }}
          aria-label={isEn ? "New Hotel" : "新建酒店"}
          title={isEn ? "New Hotel" : "新建酒店"}
          className="w-10 h-10 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-transform active:scale-95 shrink-0"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      {/* 国家·城市联动筛选弹窗 */}
      <LocationFilterModal
        isOpen={showLocationFilter}
        onClose={() => setShowLocationFilter(false)}
        countries={countries}
        cityCountryPairs={cityCountryPairs}
        selectedCountry={country}
        selectedCity={city}
        onSelect={(nextCountry, nextCity) => {
          setCountry(nextCountry);
          setCity(nextCity);
        }}
        formatCountry={(c) => getLocalizedCountry(c, locale)}
        formatCity={(c) => getLocalizedCity(c, locale, country === "all" || !country ? undefined : country)}
        isEn={isEn}
      />

      {/* Loading 状态 */}
      {loading && (
        <div className="mt-12 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
        </div>
      )}

      {/* Grid — 3 列微型网格布局（1:1 对齐百科卡片） */}
      {!loading && visible.length > 0 && (
        <section className="grid grid-cols-3 gap-2.5 w-full my-3 px-1.5">
          {visible.map((h) => {
            const cityLabel = getLocalizedCity(h.city, locale, h.country);
            const countryLabel = getLocalizedCountry(h.country, locale);
            const locationText = [cityLabel, countryLabel].filter(Boolean).join(", ");
            const stayText = formatStayDates(h.checkInDate, h.checkOutDate);
            return (
              <article
                key={h.id}
                onClick={() => setOpenId(h.id)}
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card shadow-lg transition-all hover:border-border cursor-pointer"
              >
                {/* 1. 上半部分：铺满图片 */}
                <div className="relative w-full aspect-square bg-muted shrink-0 overflow-hidden">
                  {h.cover ? (
                    <PhotoImage
                      src={h.cover}
                      alt={h.name}
                      eager
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-card" />
                  )}
                </div>

                {/* 2. 切割线 */}
                <div className="w-full border-t border-border/80" />

                {/* 3. 下半部分：三行文字区 (名称 / 城市国家 / 入住周期) */}
                <div className="flex flex-1 flex-col justify-between px-2 py-1.5">
                  <div>
                    <h3 className="truncate text-xs font-bold leading-tight text-foreground">{h.name}</h3>
                    {locationText && (
                      <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                        {locationText}
                      </p>
                    )}
                  </div>
                  <div className="mt-1 truncate text-[9px] font-bold leading-none tracking-wider text-brand uppercase">
                    {stayText || "—"}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* 空状态占位 */}
      {!loading && visible.length === 0 && (
        <div className="mt-12 flex flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full bg-muted p-5 ring-1 ring-border">
            <BedDouble className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {isEn ? "No hotels yet" : "暂无酒店记录"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isEn
                ? "Tap the + button to add your first hotel"
                : "点击右上角加号按钮添加第一家酒店"}
            </p>
          </div>
        </div>
      )}

      {/* 编辑模式弹窗（点击已有卡片） */}
      <HotelEditModal
        hotel={active}
        onClose={() => setOpenId(null)}
        onSave={saveHotel}
        onDelete={deleteHotel}
        tripId={tripId}
      />

      {/* 新建模式弹窗 */}
      {isNewModalOpen && (
        <HotelEditModal
          hotel={newHotelDraft}
          isNew
          onClose={() => setIsNewModalOpen(false)}
          onSave={saveHotel}
          tripId={tripId}
        />
      )}
    </div>
  );
}
