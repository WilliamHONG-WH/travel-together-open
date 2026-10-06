import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Marker, useMap } from "react-map-gl/maplibre";
import { Home, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Hotel } from "./hotelData";
import { mapRowToHotel, formatStayDates, HOTEL_SELECT } from "./hotelData";
import { HotelEditModal } from "./HotelEditModal";
import { PhotoImage } from "@/components/signed-image";
import { useI18n } from "@/i18n";
import { getLocalizedCountry, getLocalizedCity } from "@/constants/locations";
import { geocodeVenue } from "@/lib/geocode";

/**
 * 酒店 × 地图联动图层
 *
 * 1. 数据源：hotels 表（当前行程、含经纬度的条目），Realtime 监听自动重拉。
 * 2. 标记外观：纯实心小房子（无任何圆形底圈/边框/照片气泡），indigo 实心
 *    填充 + 微弱投影，明显区分于百科金色星星和打卡邮票；街区尺度
 *    （zoom >= 14）放大一档便于识别。
 * 3. 两阶段点击：标记 → Mini 卡片 → 完整酒店详情弹窗（复用 HotelEditModal，
 *    关闭后丝滑停留在地图模块）。
 */
export function HotelMapLayer({
  tripId,
  isStreetZoom,
  focusHotelId,
}: {
  tripId: string;
  /** 是否达到街区尺度（zoom >= 14），由父组件 zoomend 计算传入 */
  isStreetZoom: boolean;
  /** 酒店详情「一键跳转地图定位」深链：hotels.id */
  focusHotelId?: string | null;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const { current: map } = useMap();
  const navigate = useNavigate();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 已消费过的酒店深链 id（防止 Realtime 重拉 hotels 反复重新飞行）
  const consumedHotelFocusRef = useRef<string | null>(null);

  // 拉取当前行程的酒店：客户端过滤有效经纬度（防 [null,null] 白屏崩溃）
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("hotels")
          .select(HOTEL_SELECT)
          .eq("trip_id", tripId);
        if (error) throw error;
        if (!data || cancelled) return;
        setHotels((data as any[]).map(mapRowToHotel));
      } catch (err) {
        console.warn("[HotelMapLayer] fetch error:", err);
      }
    };
    void load();

    // Realtime 实时同步：酒店增删改后自动重拉标记点
    const channel = (supabase as any)
      .channel(`hotels-map:${tripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hotels" },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      (supabase as any).removeChannel(channel);
    };
  }, [tripId]);

  // 仅渲染有效经纬度的酒店（类型/NaN/Finite/(0,0) 严格过滤）
  const locatedHotels = useMemo(
    () =>
      hotels.filter(
        (h) =>
          typeof h.latitude === "number" &&
          typeof h.longitude === "number" &&
          !isNaN(h.latitude) &&
          !isNaN(h.longitude) &&
          isFinite(h.latitude) &&
          isFinite(h.longitude) &&
          h.latitude !== 0 &&
          h.longitude !== 0,
      ),
    [hotels],
  );

  // ── 酒店详情「一键跳转地图定位」深链消费（对齐 ?museum= 百科深链模式）──
  // 酒店数据异步拉取完成后：平滑飞行聚焦到酒店坐标（zoom 16 街区尺度），
  // 并高亮该酒店标记（弹出 Mini 预览卡片），最后清除 URL 深链参数防止重复触发。
  useEffect(() => {
    if (!focusHotelId || consumedHotelFocusRef.current === focusHotelId) return;
    const target = locatedHotels.find((h) => h.id === focusHotelId);
    if (!target) return;
    consumedHotelFocusRef.current = focusHotelId;
    map?.flyTo({
      center: [target.longitude!, target.latitude!],
      zoom: 16,
      duration: 1200,
    });
    setSelectedId(target.id);
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: {},
      replace: true,
    });
  }, [focusHotelId, locatedHotels, map, navigate, tripId]);

  const selected = useMemo(
    () => locatedHotels.find((h) => h.id === selectedId) ?? null,
    [locatedHotels, selectedId],
  );
  const detail = useMemo(
    () => locatedHotels.find((h) => h.id === detailId) ?? null,
    [locatedHotels, detailId],
  );

  // ---------- 地图内编辑链路 ----------
  const handleSave = async (updated: Hotel) => {
    try {
      // 名称/地址/城市变化或坐标缺失时重新正向地理编码
      const prev = hotels.find((h) => h.id === updated.id);
      const geoChanged =
        !!prev &&
        (prev.address !== updated.address ||
          prev.city !== updated.city ||
          prev.country !== updated.country ||
          prev.name !== updated.name);
      let geo: { lat: number; lng: number } | null = null;
      if (geoChanged || updated.latitude == null || updated.longitude == null) {
        geo = await geocodeVenue({
          name: updated.name,
          address: updated.address,
          cityKey: updated.city,
          countryKey: updated.country,
        });
      }
      const { error } = await (supabase as any)
        .from("hotels")
        .update({
          name: updated.name,
          city: updated.city || "",
          country: updated.country || "",
          address: updated.address || "",
          latitude: geo ? geo.lat : updated.latitude ?? null,
          longitude: geo ? geo.lng : updated.longitude ?? null,
          check_in_date: updated.checkInDate || null,
          check_out_date: updated.checkOutDate || null,
          notes: updated.notes || "",
          cover_image_url: updated.cover || "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", updated.id);
      if (error) throw new Error(error.message);
      setHotels((prev) =>
        prev.map((h) =>
          h.id === updated.id
            ? { ...updated, latitude: geo?.lat ?? h.latitude, longitude: geo?.lng ?? h.longitude }
            : h,
        ),
      );
      toast.success(isEn ? "Hotel updated" : "酒店已更新");
      setDetailId(null);
    } catch (err: any) {
      console.error("[HotelMapLayer] save failed:", err);
      toast.error(
        isEn
          ? `Failed to save: ${err?.message || "database error"}`
          : `酒店保存失败: ${err?.message || "数据库异常"}`,
      );
    }
  };

  const handleDelete = async (id: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("hotels").delete().eq("id", id);
    if (error) {
      toast.error(isEn ? "Failed to delete" : "删除失败");
      return false;
    }
    setHotels((prev) => prev.filter((h) => h.id !== id));
    toast.success(isEn ? "Hotel deleted" : "酒店已删除");
    return true;
  };

  return (
    <>
      {locatedHotels.map((h) => (
        <Marker
          key={h.id}
          longitude={h.longitude!}
          latitude={h.latitude!}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setSelectedId(h.id === selectedId ? null : h.id);
          }}
        >
          <HotelHouseMarker active={selectedId === h.id} large={isStreetZoom} />
        </Marker>
      ))}

      {/* 第一阶段：标记上方的 Mini 卡片 */}
      {selected && (
        <Marker
          latitude={selected.latitude!}
          longitude={selected.longitude!}
          anchor="bottom"
          offset={[0, -34]}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              // 第二阶段：点击 Mini 卡片 → 呼出完整酒店详情弹窗（留在地图界面）
              setDetailId(selected.id);
              setSelectedId(null);
            }}
            className="w-60 cursor-pointer select-none overflow-hidden rounded-xl border border-violet-400/40 bg-card/95 shadow-xl backdrop-blur-md transition-transform active:scale-[0.98]"
          >
            <div className="flex gap-3 p-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-violet-400/60">
                {selected.cover ? (
                  <PhotoImage
                    src={selected.cover}
                    alt={selected.name}
                    eager
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-violet-400/15 text-violet-500">
                    <Home className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-sm font-bold text-foreground">{selected.name}</h4>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[
                    getLocalizedCity(selected.city, locale, selected.country),
                    getLocalizedCountry(selected.country, locale),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wider text-violet-500">
                  {formatStayDates(selected.checkInDate, selected.checkOutDate) || "—"}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-violet-400/20 bg-violet-400/10 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-violet-500">
                {isEn ? "View Hotel Details" : "查看酒店详情"}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-violet-500" />
            </div>
          </div>
        </Marker>
      )}

      {/* 第二阶段：完整酒店详情弹窗（复用 HotelEditModal，
          关闭后丝滑返回当前地图视角与缩放层级） */}
      {detail && (
        <HotelEditModal
          hotel={detail}
          onClose={() => setDetailId(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          tripId={tripId}
          // 地图模块：关闭按钮置左上角，避开「足迹地图」浮动卡片遮挡
          closeButtonPosition="left"
          // 地图内酒店详情「一键定位」：关闭弹窗 → 平滑飞行聚焦 + 高亮标记
          onLocateOnMap={() => {
            setDetailId(null);
            if (detail.latitude != null && detail.longitude != null) {
              map?.flyTo({
                center: [detail.longitude, detail.latitude],
                zoom: 16,
                duration: 1200,
              });
              setSelectedId(detail.id);
            } else {
              toast.error(isEn ? "No coordinates yet, unable to locate" : "暂无坐标，无法定位");
            }
          }}
        />
      )}
    </>
  );
}

/**
 * 酒店标记：纯实心小房子（彻底去圆圈 — 无底圈/边框/照片气泡）
 * indigo-500 实心填充 + 微弱投影 drop-shadow-md，明显区分于百科金色星星与
 * 打卡邮票；街区尺度（zoom >= 14）放大一档，选中时 scale-125 强调。
 */
function HotelHouseMarker({ active, large }: { active: boolean; large?: boolean }) {
  return (
    <div
      // 标记容器强制透明：清除地图库默认方形背景/边框（防黑影脏块）
      className="cursor-pointer border-none bg-transparent p-0"
      style={{ background: "transparent", border: "none" }}
    >
      <Home
        className={`${
          large ? "h-7 w-7" : "h-5 w-5"
        } fill-indigo-500 text-indigo-500 drop-shadow-md transition-transform duration-200 hover:scale-125 ${
          active ? "scale-125" : ""
        }`}
      />
    </div>
  );
}
