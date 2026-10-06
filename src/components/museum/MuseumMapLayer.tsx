import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Marker, useMap } from "react-map-gl/maplibre";
import { Star, Landmark, Clock, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mapRowToMuseum } from "./MuseumEncyclopedia";
import { MuseumDetail } from "./MuseumDetail";
import type { Museum } from "./museumData";
import { PhotoImage } from "@/components/signed-image";
import { useI18n } from "@/i18n";
import { getLocalizedCountry, getLocalizedCity } from "@/constants/locations";
import { geocodeVenue, geocodeVenuePrecise, isCityCenterCoord, getCuratedLandmarkCoord } from "@/lib/geocode";

/** 街区尺度阈值：zoom >= 14 渲染圆形照片标记，否则折叠为金色星星。
 *  导出给地图页 zoomend 监听使用 —— 父组件只传布尔标记，避免连续
 *  zoom 值 prop 造成的标记树逐帧重渲染。 */
export const ZOOM_PHOTO_THRESHOLD = 14;

/**
 * 地理编码限速间隔（毫秒）。
 * Nominatim 官方使用政策为「每秒最多 1 次请求」，300ms 间隔会触发
 * 403 限流导致大面积定位失败（即此前"只有个别场所有坐标"的根因），
 * 故按 1.1s 限速逐条补录；每条间隔仅首屏一次性成本。
 */
const GEOCODE_RATE_LIMIT_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MUSEUM_SELECT =
  "id, title, subtitle, description, image_url, opening_hours, country_key, city_key, address, location, is_planned, created_at, exhibits, artifacts, attachments, latitude, longitude";

/**
 * 博物馆百科 × 地图联动图层
 *
 * 1. 数据源：encyclopedia_items（当前行程、含经纬度的条目），
 *    Realtime 监听全表变更自动重拉 —— 百科卡片的增加/修改/删除实时同步到标记点。
 * 2. 缩放自适应：高 zoom 显示封面圆形照片标记（金色描边），低 zoom 折叠为金色星星。
 * 3. 两阶段点击：标记 → 浮动预览气泡 → 完整百科详情弹窗（复用 MuseumDetail，
 *    全程停留在地图界面，关闭后丝滑返回当前视角与缩放层级）。
 */
export function MuseumMapLayer({
  tripId,
  isStreetZoom,
  focusMuseumId,
}: {
  tripId: string;
  /** 是否达到街区尺度（zoom >= ZOOM_PHOTO_THRESHOLD），由父组件 zoomend 计算传入 */
  isStreetZoom: boolean;
  /** 百科详情「一键跳转地图定位」深链：encyclopedia_items.id */
  focusMuseumId?: string | null;
}) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const { current: map } = useMap();
  const navigate = useNavigate();
  const [museums, setMuseums] = useState<Museum[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 已消费过的博物馆深链 id（防止 Realtime 重拉 museums 反复重新飞行）
  const consumedMuseumFocusRef = useRef<string | null>(null);
  // 已尝试过自动补坐标的条目 id（含失败），避免 Realtime 重拉时反复重试
  const backfillAttemptedRef = useRef<Set<string>>(new Set());
  // 自动补录任务进行中标记（防止 Realtime 事件触发并发重复补录）
  const backfillRunningRef = useRef(false);

  // 拉取当前行程的百科场馆：
  // 1. 不在服务端用 .not() 过滤坐标（字段异常时整条查询失败会导致零标记），
  //    拉全量后客户端过滤出有效经纬度的条目。
  // 2. 历史「全量自动补坐标」：无坐标 / 旧版城市中心值的条目，按 1.1s 限速
  //    逐条调用三级建筑级地理编码（Nominatim 政策为 1 req/s，过快会被 403），
  //    成功后立即回写数据库并更新地图点位 state —— 打开地图后几秒至几十秒内
  //    所有历史场馆自动全量点亮在精确街道位置，无需用户手动编辑。
  //    三级均失败的条目保持 null 不上图（绝不重叠在城市中心）。
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("encyclopedia_items")
          .select(MUSEUM_SELECT)
          .eq("trip_id", tripId);
        if (error) throw error;
        if (!data || cancelled) return;

        const mapped = (data as any[]).map(mapRowToMuseum);
        setMuseums(mapped);

        // ── 全量自动补坐标（互斥执行，防止 Realtime 事件并发重入）──
        if (backfillRunningRef.current) return;
        const pending = mapped.filter((m) => {
          if (backfillAttemptedRef.current.has(m.id)) return false;
          if (m.latitude == null || m.longitude == null) return true;
          if (isCityCenterCoord(m.latitude, m.longitude, m.cityKey, m.countryKey)) return true;
          // 权威地标字典校准回写：字典中存在人工校准的精准坐标且与库中值不一致
          // （如戴克里先浴场移出环岛中心、马西莫宫大门坐标修正）时，重写数据库。
          // 字典命中走 geocodeVenuePrecise 第 0 级，零网络开销。
          const curated = getCuratedLandmarkCoord(m.name) ?? getCuratedLandmarkCoord(m.nameCn);
          if (
            curated &&
            (Math.abs(curated.lat - m.latitude) > 1e-6 ||
              Math.abs(curated.lng - m.longitude) > 1e-6)
          ) {
            return true;
          }
          return false;
        });
        if (pending.length === 0) return;
        backfillRunningRef.current = true;

        try {
          for (const m of pending) {
            if (cancelled) return;
            // 限速：与上一次请求间隔 ≥ 1.1s，遵守 Nominatim 1 req/s 政策
            await sleep(GEOCODE_RATE_LIMIT_MS);
            backfillAttemptedRef.current.add(m.id);

            const precise = await geocodeVenuePrecise({
              name: m.name,
              foreignName: m.nameCn,
              address: m.address,
              cityKey: m.cityKey,
              countryKey: m.countryKey,
            });
            if (!precise) continue; // 三级均失败：保持 null，不上图

            // 定位成功 → 立即同步回写 Supabase
            const { error: upErr } = await (supabase as any)
              .from("encyclopedia_items")
              .update({ latitude: precise.lat, longitude: precise.lng })
              .eq("id", m.id);
            if (upErr) console.warn("[MuseumMapLayer] backfill update failed:", upErr);
            // 实时更新地图点位 state（标记立刻浮现）
            if (!cancelled) {
              setMuseums((prev) =>
                prev.map((x) =>
                  x.id === m.id ? { ...x, latitude: precise.lat, longitude: precise.lng } : x,
                ),
              );
            }
          }
        } finally {
          backfillRunningRef.current = false;
        }
      } catch (err) {
        console.warn("[MuseumMapLayer] fetch error:", err);
      }
    };
    void load();

    // Realtime 实时同步：百科条目增删改后自动重拉标记点
    // （需在 Supabase 执行 ALTER PUBLICATION supabase_realtime ADD TABLE encyclopedia_items）
    const channel = (supabase as any)
      .channel(`encyclopedia-map:${tripId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "encyclopedia_items" },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      (supabase as any).removeChannel(channel);
    };
  }, [tripId]);

  // ── 百科详情「一键跳转地图定位」深链消费（对齐 ?focus= 打卡深链模式）──
  // 博物馆数据异步拉取完成后：平滑飞行聚焦到场馆坐标（zoom 16 街区尺度），
  // 并自动弹出该场馆的轻量预览气泡卡片，最后清除 URL 深链参数防止重复触发。
  useEffect(() => {
    if (!focusMuseumId || consumedMuseumFocusRef.current === focusMuseumId) return;
    const target = museums.find((m) => m.id === focusMuseumId);
    if (!target || target.latitude == null || target.longitude == null) return;
    consumedMuseumFocusRef.current = focusMuseumId;
    map?.flyTo({
      center: [target.longitude, target.latitude],
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
  }, [focusMuseumId, museums, map, navigate, tripId]);

  // 仅渲染有效经纬度的场馆（白屏崩溃防御守卫）：
  // 地图库（MapLibre/Leaflet）只要收到 [null,null] / [NaN,NaN] 坐标就会抛出
  // Uncaught Error 导致全图白屏 —— 必须严格过滤：类型为 number、非 NaN、
  // 经 isFinite 校验、且非 (0,0)（无效定位兜底写入的空值）。
  const locatedMuseums = useMemo(
    () =>
      museums.filter(
        (m) =>
          typeof m.latitude === "number" &&
          typeof m.longitude === "number" &&
          !isNaN(m.latitude) &&
          !isNaN(m.longitude) &&
          isFinite(m.latitude) &&
          isFinite(m.longitude) &&
          m.latitude !== 0 &&
          m.longitude !== 0,
      ),
    [museums],
  );

  const highZoom = isStreetZoom;
  const selected = useMemo(
    () => locatedMuseums.find((m) => m.id === selectedId) ?? null,
    [locatedMuseums, selectedId],
  );
  const detail = useMemo(
    () => locatedMuseums.find((m) => m.id === detailId) ?? null,
    [locatedMuseums, detailId],
  );

  // ---------- 地图内编辑链路：与百科模块共用同一套表结构 ----------
  const handleTogglePlanned = async (id: string) => {
    const target = museums.find((m) => m.id === id);
    if (!target) return;
    const next = !target.planned;
    setMuseums((prev) => prev.map((m) => (m.id === id ? { ...m, planned: next } : m)));
    const { error } = await (supabase as any)
      .from("encyclopedia_items")
      .update({ is_planned: next })
      .eq("id", id);
    if (error) {
      // 失败回滚
      setMuseums((prev) => prev.map((m) => (m.id === id ? { ...m, planned: target.planned } : m)));
      toast.error(isEn ? "Failed to update plan status" : "更新计划状态失败");
    }
  };

  const handleSave = async (updated: Museum) => {
    try {
      // 名称/地址/城市变化或坐标缺失时重新正向地理编码
      const prev = museums.find((m) => m.id === updated.id);
      const geoChanged =
        !!prev &&
        (prev.address !== updated.address ||
          prev.cityKey !== updated.cityKey ||
          prev.name !== updated.name);
      let geo: { lat: number; lng: number } | null = null;
      if (geoChanged || updated.latitude == null || updated.longitude == null) {
        geo = await geocodeVenue({
          name: updated.name,
          foreignName: updated.nameCn,
          address: updated.address,
          cityKey: updated.cityKey,
          countryKey: updated.countryKey,
        });
      }
      const { error } = await (supabase as any)
        .from("encyclopedia_items")
        .update({
          title: updated.name,
          subtitle: updated.nameCn || "",
          description: updated.intro || "",
          country_key: updated.countryKey || "",
          city_key: updated.cityKey || "",
          opening_hours: updated.hours || "",
          image_url: updated.cover || "",
          is_planned: !!updated.planned,
          address: updated.address || "",
          location: updated.location || updated.address || "",
          exhibits: updated.exhibits || [],
          artifacts: updated.artifacts || [],
          attachments: updated.attachments || [],
          ...(geo ? { latitude: geo.lat, longitude: geo.lng } : {}),
        })
        .eq("id", updated.id);
      if (error) throw new Error(error.message);
      setMuseums((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? { ...updated, latitude: geo?.lat ?? m.latitude, longitude: geo?.lng ?? m.longitude }
            : m,
        ),
      );
      toast.success(isEn ? "Encyclopedia entry updated" : "百科卡片已更新");
      setDetailId(null);
    } catch (err: any) {
      console.error("[MuseumMapLayer] save failed:", err);
      toast.error(
        isEn
          ? `Failed to save: ${err?.message || "database error"}`
          : `百科卡片保存失败: ${err?.message || "数据库异常"}`,
      );
    }
  };

  const handleDelete = async (id: string): Promise<boolean> => {
    const { error } = await (supabase as any)
      .from("encyclopedia_items")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(isEn ? "Failed to delete" : "删除失败");
      return false;
    }
    setMuseums((prev) => prev.filter((m) => m.id !== id));
    toast.success(isEn ? "Encyclopedia entry deleted" : "百科卡片已删除");
    return true;
  };

  return (
    <>
      {locatedMuseums.map((m) => (
        <Marker
          key={m.id}
          longitude={m.longitude!}
          latitude={m.latitude!}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setSelectedId(m.id === selectedId ? null : m.id);
          }}
        >
          {highZoom ? (
            <MuseumPhotoMarker museum={m} active={selectedId === m.id} />
          ) : (
            <MuseumStarMarker active={selectedId === m.id} />
          )}
        </Marker>
      ))}

      {/* 第一阶段：标记上方的浮动预览气泡 */}
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
              // 第二阶段：点击气泡 → 呼出完整百科详情弹窗（留在地图界面）
              setDetailId(selected.id);
              setSelectedId(null);
            }}
            className="w-60 cursor-pointer select-none overflow-hidden rounded-xl border border-amber-400/40 bg-card/95 shadow-xl backdrop-blur-md transition-transform active:scale-[0.98]"
          >
            <div className="flex gap-3 p-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-amber-400/60">
                {selected.cover ? (
                  <PhotoImage
                    src={selected.cover}
                    alt={selected.name}
                    eager
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-amber-400/15 text-amber-500">
                    <Landmark className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-sm font-bold text-foreground">{selected.name}</h4>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {[
                    getLocalizedCity(selected.cityKey, locale, selected.countryKey),
                    getLocalizedCountry(selected.countryKey, locale),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-bold uppercase tracking-wider text-amber-500">
                  <Clock className="h-3 w-3 shrink-0" />
                  {selected.hours || "10:00 - 20:00"}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-amber-400/20 bg-amber-400/10 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-amber-500">
                {isEn ? "View Details / Guide" : "查看详情 / 导览"}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-amber-500" />
            </div>
          </div>
        </Marker>
      )}

      {/* 第二阶段：完整百科详情弹窗（复用 MuseumDetail，portal 挂载到 body，
          关闭后丝滑返回当前地图视角与缩放层级） */}
      {detail && (
        <MuseumDetail
          museum={detail}
          onClose={() => setDetailId(null)}
          onSave={handleSave}
          onTogglePlanned={handleTogglePlanned}
          onDelete={handleDelete}
          tripId={tripId}
          // 地图模块：关闭按钮置左上角，避开「足迹地图」浮动卡片遮挡
          closeButtonPosition="left"
          // 地图内百科详情「一键定位」：关闭弹窗 → 平滑飞行聚焦 + 弹出预览气泡。
          // coords 为详情侧实时反算出的最新坐标（无坐标条目定位时回传），优先于旧值飞行。
          onLocateOnMap={(coords) => {
            setDetailId(null);
            const lat = coords?.lat ?? detail.latitude;
            const lng = coords?.lng ?? detail.longitude;
            if (lat != null && lng != null) {
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
    </>
  );
}

/**
 * 街区尺度（zoom >= 14）：圆形照片标记
 * 封面缩略图 + 金色/琥珀色外圈描边 + 微小金色地标徽标，明显区分于打卡邮票。
 */
function MuseumPhotoMarker({ museum, active }: { museum: Museum; active: boolean }) {
  const size = active ? 52 : 46;
  return (
    <div
      // 标记容器强制透明：清除地图库默认方形背景/边框（防黑影脏块）
      className="relative cursor-pointer bg-transparent border-0 p-0 shadow-none !border-none !bg-transparent transition-transform duration-200 hover:scale-105"
      style={{ width: size, height: size, background: "transparent", border: "none" }}
    >
      <div
        className={`h-full w-full overflow-hidden rounded-full bg-muted ring-2 ring-amber-400 shadow-md ${
          active ? "ring-[3px] ring-amber-300" : ""
        }`}
      >
        {museum.cover ? (
          <PhotoImage
            src={museum.cover}
            alt={museum.name}
            eager
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-amber-400/15 text-amber-500">
            <Landmark className="h-5 w-5" />
          </div>
        )}
      </div>
      {/* 微型金色地标徽标 — 右下角小标识 */}
      <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow-md">
        <Landmark className="h-2.5 w-2.5" />
      </div>
    </div>
  );
}

/**
 * 广域宏观尺度（zoom < 14）：纯扁平化金色星标，避免城市/国家尺度下遮挡地图。
 * 彻底移除一切发光/阴影/模糊滤镜（防止多标记重叠时产生刺眼黄色光晕）：
 * - 无 drop-shadow、无 shadow、无任何 filter
 * - 纯净矢量填充：fill-amber-400 + text-amber-500 stroke-[1.5]，边缘干脆利落
 * - 外层容器强制透明，清除地图库默认方形背景与外框
 */
function MuseumStarMarker({ active }: { active: boolean }) {
  return (
    <div
      className="bg-transparent border-none p-0 shadow-none"
      style={{ background: "transparent", border: "none", boxShadow: "none", filter: "none" }}
    >
      <Star
        className={`w-5 h-5 fill-amber-400 text-amber-500 stroke-[1.5] transition-transform duration-200 hover:scale-125 ${
          active ? "scale-125" : ""
        }`}
      />
    </div>
  );
}
