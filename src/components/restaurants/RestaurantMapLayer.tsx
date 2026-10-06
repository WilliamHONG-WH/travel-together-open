import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Marker, useMap } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { geocodeVenue } from "@/lib/geocode";
import { normalizeRestaurant, mealMeta, type MealType, type Restaurant } from "./types";
import { RestaurantDetailModal } from "./RestaurantDetailModal";
import { RestaurantEditModal } from "./RestaurantEditModal";
import { persistRestaurant } from "./persist";

// Cast supabase to any for tables not yet in generated types
const db = supabase as any;

/**
 * 餐厅 × 地图联动图层
 *
 * 1. 数据源：trip_restaurants 表（当前行程、含经纬度的条目），Realtime 监听自动重拉。
 * 2. 标记外观：统一哑光珊瑚橙圆形底座（白边 + 微弱基础投影，无任何荧光/发光扩散），
 *    内部白色扁平线条图标区分餐段（牛角包/刀叉/红酒杯/咖啡杯）——
 *    与金色星星（景点）、小房子（酒店）保持一致的平光哑光质感。
 * 3. 点击交互：点击标记直接呼出完整 RestaurantDetailModal（地图界面上层），
 *    关闭后丝滑停留在当前地图视角；详情弹窗内置黄色「地图定位」按钮就地飞行聚焦。
 */
export function RestaurantMapLayer({
  tripId,
  isStreetZoom,
  focusRestaurantId,
}: {
  tripId: string;
  /** 是否达到街区尺度（zoom >= 14），由父组件 zoomend 计算传入；标记随尺度放大一档（对齐小房子） */
  isStreetZoom: boolean;
  /** 餐厅详情「一键跳转地图定位」深链：trip_restaurants.id */
  focusRestaurantId?: string | null;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const { current: map } = useMap();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Restaurant | null>(null);
  // 已消费过的餐厅深链 id（防止 Realtime 重拉 restaurants 反复重新飞行）
  const consumedRestaurantFocusRef = useRef<string | null>(null);
  // 后台补齐坐标去重：已尝试过的餐厅 id（防 Realtime 重拉反复编码同一批）
  const backfilledRef = useRef<Set<string>>(new Set());

  // ── 后台自动补齐坐标 ──
  // 缺失经纬度但携带地址/名称的餐厅：顺序正向地理编码（尊重 Nominatim 限流）
  // 后写回 DB + 本地状态，确保所有有地址的餐厅全部在地图上点亮实色餐段图标。
  const backfillMissingCoords = async (list: Restaurant[]) => {
    const pending = list.filter(
      (r) =>
        (r.latitude == null || r.longitude == null) &&
        !backfilledRef.current.has(r.id) &&
        !!(r.address || r.name),
    );
    if (pending.length === 0) return;
    pending.forEach((r) => backfilledRef.current.add(r.id));
    for (const r of pending) {
      try {
        const geo = await geocodeVenue({
          name: r.name,
          address: r.address,
          cityKey: r.city,
          countryKey: r.country,
        });
        if (!geo) continue;
        const { error } = await db
          .from("trip_restaurants")
          .update({ latitude: geo.lat, longitude: geo.lng, updated_at: new Date().toISOString() })
          .eq("id", r.id);
        if (error) {
          // 写库失败：移出去重集合，允许下次 Realtime 重拉时重试
          backfilledRef.current.delete(r.id);
          continue;
        }
        setRestaurants((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, latitude: geo.lat, longitude: geo.lng } : x)),
        );
      } catch (err) {
        backfilledRef.current.delete(r.id);
        console.warn("[RestaurantMapLayer] backfill geocode failed:", err);
      }
    }
  };

  // 拉取当前行程的餐厅：客户端过滤有效经纬度（防脏数据渲染到 (0,0)）
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await db
          .from("trip_restaurants")
          .select("*")
          .eq("trip_id", tripId);
        if (error) throw error;
        if (!data || cancelled) return;
        const mapped = (data as any[]).map(normalizeRestaurant);
        setRestaurants(mapped);
        // 后台异步补齐缺失坐标（有地址的餐厅全部点亮标记）
        void backfillMissingCoords(mapped);
      } catch (err) {
        console.warn("[RestaurantMapLayer] fetch error:", err);
      }
    };
    void load();

    // Realtime 实时同步：餐厅增删改后自动重拉标记点
    const channel = db
      .channel(`restaurants-map:${tripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_restaurants" },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      db.removeChannel(channel);
    };
  }, [tripId]);

  // 仅渲染有效经纬度的餐厅（类型/NaN/Finite/(0,0) 严格过滤）
  const locatedRestaurants = useMemo(
    () =>
      restaurants.filter(
        (r) =>
          typeof r.latitude === "number" &&
          typeof r.longitude === "number" &&
          !isNaN(r.latitude) &&
          !isNaN(r.longitude) &&
          isFinite(r.latitude) &&
          isFinite(r.longitude) &&
          r.latitude !== 0 &&
          r.longitude !== 0,
      ),
    [restaurants],
  );

  // ── 餐厅详情「一键跳转地图定位」深链消费（对齐 ?hotel= 酒店深链模式）──
  // 餐厅数据异步拉取完成后：平滑飞行聚焦到餐厅坐标（zoom 16 街区尺度），
  // 并高亮该餐厅标记，最后清除 URL 深链参数防止重复触发。
  useEffect(() => {
    if (!focusRestaurantId || consumedRestaurantFocusRef.current === focusRestaurantId) return;
    const target = locatedRestaurants.find((r) => r.id === focusRestaurantId);
    if (!target) return;
    consumedRestaurantFocusRef.current = focusRestaurantId;
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
  }, [focusRestaurantId, locatedRestaurants, map, navigate, tripId]);

  const detail = useMemo(
    () => locatedRestaurants.find((r) => r.id === detailId) ?? null,
    [locatedRestaurants, detailId],
  );

  // ---------- 地图内编辑链路（复用统一 persist 落库：上传 + 自动地理编码） ----------
  const handleSave = async (form: Restaurant, newFiles: File[]) => {
    try {
      const saved = await persistRestaurant({
        tripId,
        form,
        newFiles,
        prev: restaurants.find((r) => r.id === form.id) ?? null,
      });
      setRestaurants((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      toast.success(isEn ? "Restaurant updated" : "餐厅已更新");
    } catch (err: any) {
      console.error("[RestaurantMapLayer] save failed:", err);
      throw err;
    }
  };

  const handleDelete = async (r: Restaurant) => {
    const { error } = await db.from("trip_restaurants").delete().eq("id", r.id);
    if (error) {
      toast.error(isEn ? "Failed to delete" : "删除失败");
      throw new Error(error.message);
    }
    setRestaurants((prev) => prev.filter((x) => x.id !== r.id));
    setDetailId((id) => (id === r.id ? null : id));
    toast.success(isEn ? "Restaurant deleted" : "餐厅已删除");
  };

  return (
    <>
      {locatedRestaurants.map((r) => (
        <Marker
          key={r.id}
          longitude={r.longitude!}
          latitude={r.latitude!}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            // 直接呼出完整餐厅详情弹窗（地图界面上层，关闭后留在当前视角）
            setSelectedId(r.id);
            setDetailId(r.id);
          }}
        >
          <RestaurantMealMarker meal={r.meal_type} active={selectedId === r.id} large={isStreetZoom} />
        </Marker>
      ))}

      {/* 完整餐厅详情弹窗：复用规划模块 RestaurantDetailModal，
          关闭后丝滑返回当前地图视角与缩放层级 */}
      {detail && (
        <RestaurantDetailModal
          restaurant={detail}
          onClose={() => {
            setDetailId(null);
            setSelectedId(null);
          }}
          onEdit={(r) => {
            setDetailId(null);
            setEditing(r);
            setEditOpen(true);
          }}
          locale={locale}
          isEn={isEn}
          tripId={tripId}
          // 地图内餐厅详情「一键定位」：关闭弹窗 → 平滑飞行聚焦 + 高亮标记；
          // 弹窗侧实时反算出的 coords 优先（父层 detail 可能仍是旧的无坐标数据）
          onLocateOnMap={(coords) => {
            setDetailId(null);
            const lat = coords?.lat ?? detail.latitude;
            const lng = coords?.lng ?? detail.longitude;
            if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
              map?.flyTo({
                center: [lng, lat],
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

      {/* 地图内编辑弹窗：复用规划模块 RestaurantEditModal（含地址自动地理编码） */}
      <RestaurantEditModal
        open={editOpen}
        initial={editing}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
        locale={locale}
        isEn={isEn}
      />
    </>
  );
}

/**
 * 餐厅标记：无边框纯实色哑光珊瑚橙圆点 + 白色餐段线稿。
 * - 底座：bg-orange-500 实色填充（哑光无发光、无白色描边），仅微弱基础投影 shadow-sm；
 * - 尺寸：宏观尺度 h-5 w-5 与小房子底边宽度完全一致，街区尺度（zoom >= 14）
 *   放大至 h-7 w-7（与小房子同步放大一档）；
 * - 内纹：白色扁平线条图标按餐段等比缩放（h-3 / 街区 h-4）——
 *   早餐牛角包 / 午餐刀叉 / 晚餐红酒杯 / 下午茶咖啡杯；
 * - 选中态仅 scale-125 强调（无任何荧光/发光扩散投影）。
 */
function RestaurantMealMarker({ meal, active, large }: { meal: MealType; active: boolean; large?: boolean }) {
  const Icon = mealMeta(meal).icon;
  return (
    <div
      // 标记容器强制透明：清除地图库默认方形背景/边框（防黑影脏块）
      className="cursor-pointer border-none bg-transparent p-0"
      style={{ background: "transparent", border: "none" }}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-orange-500 shadow-sm transition-transform duration-200 hover:scale-125 ${
          large ? "h-7 w-7" : "h-5 w-5"
        } ${active ? "scale-125" : ""}`}
      >
        <Icon className={`${large ? "h-4 w-4" : "h-3 w-3"} text-white`} strokeWidth={2.5} />
      </div>
    </div>
  );
}
