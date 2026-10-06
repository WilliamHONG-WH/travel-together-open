import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Map,
  Marker,
  Source,
  Layer,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Camera, Locate, Loader2, Info } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { checkinsQueryOptions, type Checkin } from "@/lib/checkins";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { broadcastLocation } from "@/lib/user-locations";
import { useMemberFilter } from "@/lib/member-filter";
import { CheckInModal } from "@/components/checkin-modal";
import { UnlockModal } from "@/components/stamps/UnlockModal";
import { getCategoryIcon, getCategoryAccent, mapCheckinCategory } from "@/components/stamps/types";
import { CheckinDetailSheet } from "@/components/checkin-detail-sheet";
import { SignedImage } from "@/components/signed-image";
import { MemberMarkers } from "@/components/member-markers";
import { MuseumMapLayer, ZOOM_PHOTO_THRESHOLD } from "@/components/museum/MuseumMapLayer";
import { HotelMapLayer } from "@/components/hotels/HotelMapLayer";
import { RestaurantMapLayer } from "@/components/restaurants/RestaurantMapLayer";
import { MemberFilterWidget } from "@/components/member-filter-widget";
import { NavHud } from "@/components/nav-hud";
import { fetchRoute, type NavMode, type RouteInfo } from "@/lib/navigation";
import { getCategoryConfig } from "@/lib/checkin-categories";
import { getOptimizedImageUrl } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Location utilities
// ---------------------------------------------------------------------------
// 国内无 Google 服务环境下，navigator.geolocation 常常因为连不上 Google 接口而
// 报错或超时。这里在原生 GPS 失败时，自动无感切换到免密钥的 IP 定位作为保底，
// 让定位在国内网络下也能 100% 顺畅通关。
// ---------------------------------------------------------------------------

// 国内/海外均可直接访问的免密钥 IP 定位 API。按顺序尝试，第一个成功即返回。
// 关键：所有端点必须支持 HTTPS — HTTPS 网页中调用 HTTP 接口会被浏览器以
// Mixed Content 理由拦截，导致 IP 兜底完全失效（香港高楼密集区定位失败的根因之一）。
// 注：ip-api.com 免费版仅支持 HTTP，HTTPS 为付费功能，故不再使用。
const IP_GEO_ENDPOINTS = [
  "https://ipapi.co/json/",
  "https://ipwho.is/",
  "https://get.geojs.io/v1/ip/geo.json",
];

type Coords = { lat: number; lng: number };

// 洛杉矶 West 6th Street -> Loma Drive 贴路仿真路线坐标
const SIMULATED_ROUTE: [number, number][] = [
  [34.0534, -118.2612],
  [34.0542, -118.2628],
  [34.0552, -118.2638],
  [34.0562, -118.2645],
];

function getCurrentPositionP(options?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("UNSUPPORTED"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

// 原生 GPS 优先（12 秒超时），失败时无感回退到 IP 定位保底。
// 返回 { lat, lng, viaIP } 标识是否使用了 IP 保底。
//
// 安卓 Chrome / 香港高楼密集区兼容性说明：
// - enableHighAccuracy: false — 国内安卓依赖的 Google 定位服务不可用，高精度请求几乎必失败。
//   关闭高精度后浏览器可使用基站/Wi-Fi 定位，成功率大幅提升。
// - maximumAge: 60_000 — 允许使用 60 秒内的缓存定位，避免短时间内重复触发 GPS 硬件请求。
// - timeout: 12_000 — 香港高楼林立（城市峡谷效应），8 秒对原生 GPS 搜星过短，
//   放宽到 12 秒给手机搜星留出足够时间，显著减少 TIMEOUT 失败。
async function locateUser(timeoutMs = 12000): Promise<Coords & { viaIP: boolean }> {
  try {
    const pos = await getCurrentPositionP({
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 60_000,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      viaIP: false,
    };
  } catch (err) {
    // 原生定位失败（PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT / 无 Google 服务）
    // 自动且无感地发起 IP 定位作为保底。
    const fallback = await locateByIP();
    if (fallback) return { ...fallback, viaIP: true };
    // IP 定位也不可用时，抛出统一错误标识给调用方处理（不暴露英文错误码）。
    throw new Error("LOCATION_FAILED");
  }
}

// 调用免密钥 HTTPS IP 定位 API，提取纬度/经度作为保底位置。
// 多端点容错：任一端点失败（网络/CORS/字段缺失）则继续尝试下一个，全部失败才返回 null。
// 每个端点 6 秒超时，避免单个慢请求阻塞主流程。
async function locateByIP(): Promise<Coords | null> {
  for (const url of IP_GEO_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      // 字段差异适配：
      // - ipapi.co:   { latitude, longitude }
      // - ipwho.is:   { latitude, longitude }
      // - geojs.io:   { latitude, longitude }
      const lat = data.latitude ?? data.lat;
      const lng = data.longitude ?? data.lon;
      if (typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng)) {
        return { lat, lng };
      }
    } catch {
      // 当前端点失败（网络/CORS/超时/解析错误），继续尝试下一个端点
    }
  }
  return null;
}

// 地图底图：OpenFreeMap 公益 Positron 矢量风格
// ───────────────────────────────────────────────────────────────────
// - MapLibre GL 底层要求 mapStyle 传入矢量 JSON 样式链接（或内联样式对象），
//   绝不能直接传带 {z}/{x}/{y}.png 的栅格瓦片 URL —— 那会被当作 Style URL
//   解析失败导致整图白屏（即本次白屏崩溃根因）。
// - OpenFreeMap 官方 MapLibre 矢量 JSON 链接：免 API Key、无限量、永久无
//   额度上限，原版 Positron 浅灰极简风格，支持高清矢量街道渲染。
// - ⚠️ 死循环重渲染防御：mapStyle 保持模块级常量引用稳定，组件任何
//   state 变化都不会触发 setStyle()，瓦片层零重载。
const mapStyle = "https://tiles.openfreemap.org/styles/positron";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

export function TripMap({
  tripId,
  focusCheckinId,
  focusMuseumId,
  focusHotelId,
  focusRestaurantId,
  locateCheckinId,
  targetLat,
  targetLng,
  targetT,
}: {
  tripId: string;
  focusCheckinId?: string | null;
  /** 百科详情「一键跳转地图定位」深链：encyclopedia_items.id */
  focusMuseumId?: string | null;
  /** 酒店详情「一键跳转地图定位」深链：hotels.id */
  focusHotelId?: string | null;
  /** 餐厅详情「一键跳转地图定位」深链：trip_restaurants.id */
  focusRestaurantId?: string | null;
  /** 足迹详情「地图定位按钮」深链：user_stamps.id — 用于高亮对应打卡标记 */
  locateCheckinId?: string | null;
  /** 足迹定位目标纬度（字符串数字，URL 直传坐标） */
  targetLat?: string | null;
  /** 足迹定位目标经度（字符串数字，URL 直传坐标） */
  targetLng?: string | null;
  /** 足迹定位时间戳：值变化即重新触发飞行（支持反复定位同一打卡点） */
  targetT?: string | null;
}) {
  const navigate = useNavigate();
  const t = useT();
  const mapRef = useRef<MapRef>(null);
  const pressRef = useRef<{
    x: number;
    y: number;
    t: number;
    lng: number;
    lat: number;
    moved: boolean;
    timer: number | null;
  } | null>(null);

  // 缩放监听解耦：不再持有连续 zoom state（旧实现 onZoom 每帧 setState，
  // 导致整个地图组件树逐帧重渲染、瓦片层反复 diff）。这里只在缩放
  // 结束（zoomend）且跨越街区阈值时更新一次布尔标记，供博物馆图层
  // 切换照片/星星标记形态；实时缩放值需要时从 mapRef.getZoom() 读取。
  const [isStreetZoom, setIsStreetZoom] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [unlockData, setUnlockData] = useState<{ title: string; city: string; country: string; photo_url: string | null; notes: string; category: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeCheckin, setActiveCheckin] = useState<Checkin | null>(null);
  const consumedFocusRef = useRef<string | null>(null);
  // 足迹「地图定位」高亮标记 id：与 activeCheckin 解耦 —— 只放大标记 + 彩色光环，
  // 不弹出 CheckinDetailSheet（底部面板高至 90dvh 会遮挡地图，看不到定位结果）
  const [locatedCheckinId, setLocatedCheckinId] = useState<string | null>(null);
  const consumedLocateRef = useRef<string | null>(null);
  // 地图就绪标记：<Map onLoad> 后置 true —— 挂载期间 mapRef 尚未绑定 maplibre 实例，
  // 此时 flyTo 会被 ?. 可选链静默吞掉（足迹定位不飞行的根因），必须等就绪后再飞
  const [mapReady, setMapReady] = useState(false);
  // GPS 定位点状态：locateUser 成功后在此位置渲染发光波纹蓝点 Marker
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);

  // 定位加载状态：点击打卡时显示加载动画，失败时显示【重新定位】按钮，
  // 避免用户以为页面卡死而频繁盲目点击 FAB
  const [locLoading, setLocLoading] = useState(false);
  const [locFailed, setLocFailed] = useState(false);

  // 右下角版权信息展开状态：默认折叠为 ⓘ 小圆点，点击向左展开胶囊文本
  const [attrOpen, setAttributionOpen] = useState(false);

  // Navigation state
  const [navTarget, setNavTarget] = useState<Checkin | null>(null);
  const [navMode, setNavMode] = useState<NavMode>("foot");
  const [navRoute, setNavRoute] = useState<RouteInfo | null>(null);
  const [navLoading, setNavLoading] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [walkerCoords, setWalkerCoords] = useState<[number, number] | null>(null);

  const { data: checkins } = useSuspenseQuery(checkinsQueryOptions(tripId));
  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const filter = useMemberFilter(tripId, memberIds);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Focus a check-in from ?focus=<id> (deep link from chat share)
  useEffect(() => {
    if (!focusCheckinId) return;
    if (consumedFocusRef.current === focusCheckinId) return;
    const target = checkins.find((c) => c.id === focusCheckinId);
    if (!target) return;
    consumedFocusRef.current = focusCheckinId;
    mapRef.current?.flyTo({
      center: [target.lng, target.lat],
      zoom: 16,
      duration: 900,
    });
    setActiveCheckin(target);
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: {},
      replace: true,
    });
  }, [focusCheckinId, checkins, navigate, tripId]);

  // 足迹详情「地图定位按钮」：坐标经 URL 直传（targetLat/targetLng）+ 地图就绪后飞行。
  // 根因修复：从足迹切到地图时组件正在重新挂载，mapRef.current 仍为 null，
  // 切换瞬间调用 flyTo 会被静默吞掉，视角停留在默认位置 —— 故必须等 onLoad 之后再飞。
  useEffect(() => {
    if (!mapReady || !targetLat || !targetLng) return;
    // t 时间戳防重：同一时间戳只消费一次，不同时间戳（重复点击）可再次触发
    if (consumedLocateRef.current === (targetT ?? "")) return;
    consumedLocateRef.current = targetT ?? "";
    const lat = parseFloat(targetLat);
    const lng = parseFloat(targetLng);
    if (isFinite(lat) && isFinite(lng)) {
      // 注意：MapLibre 的 center 格式为 [经度 lng, 纬度 lat]
      mapRef.current?.flyTo({
        center: [lng, lat],
        zoom: 16,
        essential: true,
        duration: 1500,
      });
      // 高亮对应打卡标记（按 id 匹配；坐标仅负责飞行）
      const target = checkins.find((c) => c.id === locateCheckinId);
      if (target) setLocatedCheckinId(target.id);
    }
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: {},
      replace: true,
    });
  }, [mapReady, targetLat, targetLng, targetT, locateCheckinId, checkins, navigate, tripId]);

  const visibleCheckins = useMemo(
    () => checkins.filter((c) => !filter.hiddenIds.has(c.user_id)),
    [checkins, filter.hiddenIds],
  );

  const openWith = (lat: number, lng: number) => {
    setCoords({ lat, lng });
    setDialogOpen(true);
  };

  const onMouseDown = (e: MapLayerMouseEvent) => {
    const oe = e.originalEvent as MouseEvent;
    if (oe.button !== 0) return;
    if (pressRef.current?.timer) window.clearTimeout(pressRef.current.timer);
    const timer = window.setTimeout(() => {
      const p = pressRef.current;
      if (p && !p.moved) {
        openWith(p.lat, p.lng);
        pressRef.current = null;
      }
    }, LONG_PRESS_MS);
    pressRef.current = {
      x: oe.clientX,
      y: oe.clientY,
      t: Date.now(),
      lng: e.lngLat.lng,
      lat: e.lngLat.lat,
      moved: false,
      timer,
    };
  };

  const onMouseMove = (e: MapLayerMouseEvent) => {
    const p = pressRef.current;
    if (!p) return;
    const oe = e.originalEvent as MouseEvent;
    if (
      Math.abs(oe.clientX - p.x) > MOVE_TOLERANCE_PX ||
      Math.abs(oe.clientY - p.y) > MOVE_TOLERANCE_PX
    ) {
      p.moved = true;
      if (p.timer) window.clearTimeout(p.timer);
      p.timer = null;
    }
  };

  const onMouseUp = () => {
    const p = pressRef.current;
    if (p?.timer) window.clearTimeout(p.timer);
    pressRef.current = null;
  };

  // 实时缩放值统一从地图实例读取（避免 state 化引发逐帧重渲染）
  const getMapZoom = () => mapRef.current?.getZoom() ?? 3.5;

  const handleFabClick = async () => {
    // 加载中：忽略重复点击，避免用户盲目连点导致多次并发定位
    if (locLoading) return;

    // 清除上一次的失败状态，进入加载态
    setLocFailed(false);
    setLocLoading(true);

    // 浏览器完全不支持 geolocation 时，直接走 IP 保底
    if (!navigator.geolocation) {
      toast.loading(t("map.gettingLocation"), { id: "geo" });
      try {
        const fb = await locateByIP();
        toast.dismiss("geo");
        if (fb) {
          mapRef.current?.flyTo({ center: [fb.lng, fb.lat], zoom: Math.max(getMapZoom(), 13), duration: 800 });
          openWith(fb.lat, fb.lng);
          toast.info(t("map.locationCalibrated"));
        } else {
          setLocFailed(true);
          toast.error(t("map.ipFallbackFailed"));
        }
      } catch {
        toast.dismiss("geo");
        setLocFailed(true);
        toast.error(t("map.ipFallbackFailed"));
      } finally {
        setLocLoading(false);
      }
      return;
    }
    // 高楼密集区提示：明确告知用户正在获取高精度定位，可能需要 10-15 秒
    toast.loading(t("map.highAccuracyLocating"), { id: "geo" });
    try {
      const r = await locateUser(12000);
      toast.dismiss("geo");
      setMyLocation({ lat: r.lat, lng: r.lng });
      const targetZoom = r.viaIP ? Math.max(getMapZoom(), 12) : Math.max(getMapZoom(), 14);
      mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: targetZoom, duration: 800 });
      openWith(r.lat, r.lng);
      if (r.viaIP) toast.info(t("map.locationCalibrated"));
    } catch {
      toast.dismiss("geo");
      // 不展示英文错误码（POSITION_UNAVAILABLE/TIMEOUT 等），使用友好提示
      toast.error(t("map.locationFailed"));
      // 标记失败态：UI 显示【重新定位】按钮，引导用户明确重试而非盲目点击
      setLocFailed(true);
    } finally {
      setLocLoading(false);
    }
  };

  const handleRefreshLocation = async () => {
    // 浏览器完全不支持 geolocation 时，直接走 IP 保底
    if (!navigator.geolocation) {
      toast.loading(t("map.refreshingLocation"), { id: "geo-refresh" });
      const fb = await locateByIP();
      toast.dismiss("geo-refresh");
      if (!fb) {
        toast.error(t("map.ipFallbackFailed"));
        return;
      }
      mapRef.current?.flyTo({ center: [fb.lng, fb.lat], zoom: Math.max(getMapZoom(), 12), duration: 900 });
      try {
        if (userId) await broadcastLocation({ tripId, userId, lat: fb.lat, lng: fb.lng });
        toast.success(t("map.locationCalibrated"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("map.broadcastFailed"));
      }
      return;
    }
    toast.loading(t("map.refreshingLocation"), { id: "geo-refresh" });
    try {
      const r = await locateUser(12000);
      setMyLocation({ lat: r.lat, lng: r.lng });
      const targetZoom = r.viaIP ? Math.max(getMapZoom(), 13) : Math.max(getMapZoom(), 15);
      mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: targetZoom, duration: 900 });
      if (userId) {
        await broadcastLocation({ tripId, userId, lat: r.lat, lng: r.lng });
      }
      toast.dismiss("geo-refresh");
      if (r.viaIP) toast.success(t("map.locationCalibrated"));
      else toast.success(t("map.locationRefreshed"));
    } catch {
      toast.dismiss("geo-refresh");
      // 不展示英文错误码，使用友好提示引导用户检查权限或改用微信
      toast.error(t("map.locationFailed"));
    }
  };

  // --- Navigation logic ---
  // Start navigation: locate user, then fetch route
  const startNavigation = useCallback(async (checkin: Checkin) => {
    setNavTarget(checkin);
    setNavRoute(null);
    setNavLoading(true);

    // Get user location
    let loc: { lat: number; lng: number } | null = null;
    try {
      const r = await locateUser(12000);
      loc = { lat: r.lat, lng: r.lng };
    } catch {
      try {
        const fb = await locateByIP();
        if (fb) loc = fb;
      } catch {
        // ignore
      }
    }
    setUserLoc(loc);
    if (!loc) {
      setNavLoading(false);
      toast.error(t("map.locationFailed"));
      return;
    }

    // Fly to fit both points
    const bounds = [
      Math.min(loc.lng, checkin.lng),
      Math.min(loc.lat, checkin.lat),
      Math.max(loc.lng, checkin.lng),
      Math.max(loc.lat, checkin.lat),
    ] as [number, number, number, number];
    mapRef.current?.fitBounds(bounds, { padding: 80, duration: 800 });

    // Fetch route
    try {
      const route = await fetchRoute(loc, { lat: checkin.lat, lng: checkin.lng }, navMode);
      setNavRoute(route);
    } catch {
      toast.error(t("nav.routeFailed"));
    } finally {
      setNavLoading(false);
    }
  }, [navMode, t]);

  // Re-fetch route when mode changes during active navigation
  const handleModeChange = useCallback(async (m: NavMode) => {
    setNavMode(m);
    if (!navTarget || !userLoc) return;
    setNavLoading(true);
    setNavRoute(null);
    try {
      const route = await fetchRoute(userLoc, { lat: navTarget.lat, lng: navTarget.lng }, m);
      setNavRoute(route);
    } catch {
      toast.error(t("nav.routeFailed"));
    } finally {
      setNavLoading(false);
    }
  }, [navTarget, userLoc, t]);

  const stopNavigation = useCallback(() => {
    setNavTarget(null);
    setNavRoute(null);
    setNavLoading(false);
  }, []);

  // Route GeoJSON for map rendering
  const routeGeoJSON = useMemo(() => {
    if (!navRoute) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: navRoute.coordinates,
      },
    };
  }, [navRoute]);

  // 仿真贴路路线 GeoJSON ([lng, lat] 格式)
  const simulatedRouteGeoJSON = useMemo(() => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: SIMULATED_ROUTE.map((p) => [p[1], p[0]]),
    } as { type: "LineString"; coordinates: number[][] },
  }), []);

  // 行走小人 GeoJSON (跟随 walkerCoords 实时更新)
  const walkerGeoJSON = useMemo(() => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Point" as const,
      coordinates: walkerCoords ? [walkerCoords[1], walkerCoords[0]] : [0, 0],
    },
  }), [walkerCoords]);

  const isNavigating = !!navTarget;

  // LERP 仿真行走状态机
  useEffect(() => {
    if (!isNavigating) {
      setWalkerCoords(null);
      return;
    }
    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.005;
      if (progress > 1) progress = 0;
      const numSegments = SIMULATED_ROUTE.length - 1;
      const scaledProgress = progress * numSegments;
      const segmentIndex = Math.min(Math.floor(scaledProgress), numSegments - 1);
      const segmentProgress = scaledProgress - segmentIndex;
      const p0 = SIMULATED_ROUTE[segmentIndex];
      const p1 = SIMULATED_ROUTE[segmentIndex + 1];
      const lat = p0[0] + (p1[0] - p0[0]) * segmentProgress;
      const lng = p0[1] + (p1[1] - p0[1]) * segmentProgress;
      setWalkerCoords([lat, lng]);
    }, 40);
    return () => clearInterval(interval);
  }, [isNavigating]);

  // 流光蚂蚁线动画
  useEffect(() => {
    if (!isNavigating) return;
    let offset = 0;
    const animInterval = setInterval(() => {
      offset = (offset + 0.5) % 4;
      const map = mapRef.current;
      if (map && map.getLayer("sim-route-flow")) {
        (map as any).setPaintProperty("sim-route-flow", "line-dasharray", [offset, 1, 1, 1]);
      }
    }, 80);
    return () => clearInterval(animInterval);
  }, [isNavigating]);

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 105, latitude: 35, zoom: 3.5 }}
        mapStyle={mapStyle}
        attributionControl={false}
        minZoom={1}
        maxZoom={19}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        style={{ width: "100%", height: "100%" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onTouchStart={(e) => {
          const t = e.originalEvent.touches[0];
          if (!t) return;
          if (pressRef.current?.timer) window.clearTimeout(pressRef.current.timer);
          const timer = window.setTimeout(() => {
            const p = pressRef.current;
            if (p && !p.moved) {
              openWith(p.lat, p.lng);
              pressRef.current = null;
            }
          }, LONG_PRESS_MS);
          pressRef.current = {
            x: t.clientX,
            y: t.clientY,
            t: Date.now(),
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
            moved: false,
            timer,
          };
        }}
        onTouchMove={(e) => {
          const p = pressRef.current;
          if (!p) return;
          const t = e.originalEvent.touches[0];
          if (!t) return;
          if (
            Math.abs(t.clientX - p.x) > MOVE_TOLERANCE_PX ||
            Math.abs(t.clientY - p.y) > MOVE_TOLERANCE_PX
          ) {
            p.moved = true;
            if (p.timer) window.clearTimeout(p.timer);
            p.timer = null;
          }
        }}
        onTouchEnd={onMouseUp}
        onTouchCancel={onMouseUp}
        onZoomEnd={(e) => {
          // 只在跨越街区阈值时更新一次布尔标记（React 对相同值不重渲染），
          // 缩放过程中的连续帧完全不触发 setState，瓦片层零重载。
          const street = e.viewState.zoom >= ZOOM_PHOTO_THRESHOLD;
          setIsStreetZoom((prev) => (prev === street ? prev : street));
        }}
        onLoad={(e) => {
          // 标记地图就绪：足迹定位飞行必须等此回调后才执行（挂载期间 mapRef 未绑定）
          setMapReady(true);
          // 彻底隐藏「国家级」巨型名称图层（CHINA / FRANCE / GERMANY 等），
          // 仅保留城市/小镇/街道标注 —— 无论缩放层级，地图极致极简清爽。
          const map = mapRef.current?.getMap?.() || e.target;
          if (!map) return;
          map.getStyle().layers?.forEach((layer: any) => {
            // 1) 彻底隐藏「国家级」巨型名称图层
            if (
              layer.id.includes("country") ||
              layer.id.includes("place_country") ||
              layer.id.includes("place-country") ||
              (layer["source-layer"] === "place" && JSON.stringify(layer).includes("country"))
            ) {
              map.setLayoutProperty(layer.id, "visibility", "none");
            }

            // 2) CARTO Positron 文字图层色彩与光晕重构：消除突兀的纯黑文字
            if (layer.type !== "symbol") return;
            const id = layer.id.toLowerCase();
            if (id.includes("road") || id.includes("street") || id.includes("transportation")) {
              // 道路与街巷名称：低对比度浅铅灰，若隐若现绝不抢镜
              map.setPaintProperty(layer.id, "text-color", "#8F9CA8");
              map.setPaintProperty(layer.id, "text-halo-color", "rgba(255,255,255,0.9)");
              map.setPaintProperty(layer.id, "text-halo-width", 1.2);
            } else if (id.includes("water") || id.includes("ocean") || id.includes("sea")) {
              // 水体与海洋标签：灰蓝石板色 + 字号轻微缩小
              map.setPaintProperty(layer.id, "text-color", "#8D9AA4");
              map.setPaintProperty(layer.id, "text-halo-color", "rgba(255,255,255,0.9)");
              map.setPaintProperty(layer.id, "text-halo-width", 1.5);
              const curSize = map.getLayoutProperty(layer.id, "text-size");
              if (typeof curSize === "number") {
                map.setLayoutProperty(layer.id, "text-size", Math.round(curSize * 0.9));
              }
            } else if (id.includes("city") || id.includes("capital")) {
              // 核心大城市与首都：CARTO 经典石墨灰
              map.setPaintProperty(layer.id, "text-color", "#5B6770");
              map.setPaintProperty(layer.id, "text-halo-color", "rgba(255,255,255,0.95)");
              map.setPaintProperty(layer.id, "text-halo-width", 1.8);
              map.setPaintProperty(layer.id, "text-halo-blur", 1);
              map.setPaintProperty(layer.id, "text-opacity", 0.9);
            } else if (id.includes("town") || id.includes("village") || id.includes("suburb")) {
              // 中小城镇与行政区：柔和中灰
              map.setPaintProperty(layer.id, "text-color", "#7A8793");
              map.setPaintProperty(layer.id, "text-halo-color", "#FFFFFF");
              map.setPaintProperty(layer.id, "text-halo-width", 1.5);
            } else if (id.includes("place") || id.includes("label")) {
              // 其余地名词（社区/邻里等）：与大城市同族石墨灰
              map.setPaintProperty(layer.id, "text-color", "#5B6770");
              map.setPaintProperty(layer.id, "text-halo-color", "rgba(255,255,255,0.95)");
              map.setPaintProperty(layer.id, "text-halo-width", 1.8);
              map.setPaintProperty(layer.id, "text-halo-blur", 1);
            }
          });
        }}
      >
        {visibleCheckins.map((c: Checkin) => (
          <Marker
            key={c.id}
            longitude={c.lng}
            latitude={c.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setActiveCheckin(c);
              setLocatedCheckinId(null);
            }}
          >
            <CheckinMarker checkin={c} active={activeCheckin?.id === c.id || locatedCheckinId === c.id} />
          </Marker>
        ))}

        {/* GPS 定位发光波纹蓝点 Marker */}
        {myLocation && (
          <Marker
            longitude={myLocation.lng}
            latitude={myLocation.lat}
            anchor="center"
          >
            <UserLocationDot />
          </Marker>
        )}

        <MemberMarkers tripId={tripId} hiddenIds={filter.hiddenIds} currentUserId={userId} />

        {/* 博物馆百科联动图层：缩放自适应标记（照片/星星）+ 两阶段点击详情。
            传入阈值布尔标记而非连续 zoom 值，缩放过程不再逐帧重渲染标记树。 */}
        <MuseumMapLayer tripId={tripId} isStreetZoom={isStreetZoom} focusMuseumId={focusMuseumId} />

        {/* 酒店联动图层：宏观尺度小房子 Pin / 街区尺度封面照片气泡 + 两阶段点击详情 */}
        <HotelMapLayer tripId={tripId} isStreetZoom={isStreetZoom} focusHotelId={focusHotelId} />

        {/* 餐厅联动图层：统一哑光珊瑚橙底座 + 白色餐段线稿，点击直接呼出完整详情弹窗 */}
        <RestaurantMapLayer tripId={tripId} isStreetZoom={isStreetZoom} focusRestaurantId={focusRestaurantId} />

        {/* Navigation route line — neon green glow */}
        {routeGeoJSON && (
          <Source id="nav-route" type="geojson" data={routeGeoJSON}>
            {/* Outer glow layer */}
            <Layer
              id="nav-route-glow"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#2DD4BF",
                "line-width": 8,
                "line-opacity": 0.15,
                "line-blur": 4,
              }}
            />
            {/* Main line */}
            <Layer
              id="nav-route-main"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#2DD4BF",
                "line-width": 4,
                "line-opacity": 0.9,
              }}
            />
          </Source>
        )}

        {/* 仿真贴路路线：底层厚发光带 + 表层流光蚂蚁线 + 行走高亮圆点 */}
        {isNavigating && (
          <>
            <Source id="sim-route-glow-src" type="geojson" data={simulatedRouteGeoJSON}>
              <Layer
                id="sim-route-glow"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#06b6d4",
                  "line-width": 6,
                  "line-opacity": 0.4,
                  "line-blur": 3,
                }}
              />
            </Source>
            <Source id="sim-route-flow-src" type="geojson" data={simulatedRouteGeoJSON}>
              <Layer
                id="sim-route-flow"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": "#ffffff",
                  "line-width": 3,
                  "line-opacity": 0.9,
                  "line-dasharray": [0, 1, 1, 1],
                }}
              />
            </Source>
            {walkerCoords && (
              <Source id="sim-walker-src" type="geojson" data={walkerGeoJSON}>
                <Layer
                  id="sim-walker-halo"
                  type="circle"
                  paint={{
                    "circle-radius": 12,
                    "circle-color": "#00f6ff",
                    "circle-opacity": 0.2,
                    "circle-blur": 1.5,
                  }}
                />
                <Layer
                  id="sim-walker-core"
                  type="circle"
                  paint={{
                    "circle-radius": 6,
                    "circle-color": "#ffffff",
                    "circle-stroke-color": "#00f6ff",
                    "circle-stroke-width": 2,
                    "circle-opacity": 1,
                  }}
                />
              </Source>
            )}
          </>
        )}
      </Map>

      {/* Navigation HUD overlay */}
      {navTarget && (
        <NavHud
          target={{ lat: navTarget.lat, lng: navTarget.lng, title: navTarget.title }}
          userLocation={userLoc}
          route={navRoute}
          mode={navMode}
          loading={navLoading}
          onModeChange={handleModeChange}
          onClose={stopNavigation}
        />
      )}

      {/* 顶部 Header：仅包含右侧打卡统计器 (后退按钮由 layout 统一提供，避免重复) */}
      <div className="absolute top-0 left-0 right-0 z-[1100] flex items-start justify-end px-4 pt-[calc(env(safe-area-inset-top,12px)+8px)] pointer-events-none">
        {/* 右侧：打卡统计器 + 成员筛选器 (顶部起点固定，仅向左下扩展) */}
        <MemberFilterWidget
          tripId={tripId}
          filter={filter}
          count={visibleCheckins.length}
        />
      </div>

      {/* FAB stack: check-in + refresh location (右下角) */}
      <div
        className="absolute bottom-24 right-4 z-10 flex flex-col items-center gap-3"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={handleFabClick}
          disabled={locLoading}
          aria-label={t("map.checkinHere")}
          className={`flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg shadow-[#2DD4BF]/30 transition-transform hover:bg-brand/90 active:scale-95 ${
            locLoading ? "opacity-70 cursor-not-allowed" : ""
          }`}
        >
          {locLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Camera className="h-6 w-6" />
          )}
        </button>

        {/* 定位失败时显示【重新定位】按钮，引导用户明确重试而非盲目点击 FAB */}
        {locFailed && (
          <button
            type="button"
            onClick={handleFabClick}
            disabled={locLoading}
            className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] font-semibold text-destructive shadow-md backdrop-blur-xl transition-colors hover:bg-destructive/20 active:scale-95"
          >
            <Locate className="h-3 w-3" />
            {t("map.retryLocation")}
          </button>
        )}

        <button
          type="button"
          onClick={handleRefreshLocation}
          aria-label={t("map.refreshLocation")}
          className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-md backdrop-blur-xl transition-colors active:scale-95 ${
            myLocation
              ? "border-brand bg-brand/20 text-brand"
              : "border-border bg-card/90 text-muted-foreground hover:bg-muted"
          }`}
        >
          <Locate className="h-5 w-5" />
        </button>

        {/* 版权 ⓘ 按钮：与上方拍照/定位按钮同轴垂直对齐（同一 flex 容器），
            点击向左平滑弹出版权胶囊气泡，再点 ⓘ 或气泡本体收起 */}
        <div className="relative">
          {attrOpen && (
            <div
              onClick={() => setAttributionOpen(false)}
              className="absolute right-full mr-2 top-1/2 -translate-y-1/2 flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-slate-700/60 bg-[#0B132B]/90 px-3 py-1 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-right-2 duration-200"
            >
              <span className="text-[11px] font-medium text-white">© OSM</span>
              <span className="text-[11px] font-medium text-[#2DD4BF]">© OpenStreetMap</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setAttributionOpen((v) => !v)}
            aria-label="Attribution"
            className="flex w-7 h-7 items-center justify-center rounded-full border border-slate-700/60 bg-[#0B132B]/80 text-slate-300 shadow-md backdrop-blur-sm transition-all hover:bg-[#0B132B] active:scale-95"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {coords && (
        <CheckInModal
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSuccess={(data) => {
            setUnlockData(data);
            setDialogOpen(false);
          }}
          tripId={tripId}
          lat={coords.lat}
          lng={coords.lng}
        />
      )}

      {unlockData && (
        <UnlockModal
          entry={{
            id: "unlock-" + Date.now(),
            title: unlockData.title,
            iconCode: getCategoryIcon(unlockData.category),
            photo: unlockData.photo_url || null,
            location: unlockData.city,
            city: unlockData.city,
            country: unlockData.country,
            category: mapCheckinCategory(unlockData.category),
            description: unlockData.notes,
            accent: getCategoryAccent(unlockData.category),
            creator: { name: "You", color: "bg-brand" },
            createdAt: new Date().toISOString(),
            note: unlockData.notes,
            isFeatured: false,
          }}
          onClose={() => setUnlockData(null)}
          onViewFeed={() => {
            // 跳转到「足迹」Tab，Map 标记的 query key 也会随之刷新
            navigate({ to: "/trips/$tripId/footprints", params: { tripId } });
          }}
        />
      )}

      <CheckinDetailSheet
        checkin={activeCheckin}
        tripId={tripId}
        currentUserId={userId}
        onOpenChange={(open) => {
          if (!open) setActiveCheckin(null);
        }}
        onShared={() => {
          navigate({ to: "/trips/$tripId/chat", params: { tripId } });
        }}
        onNavigate={(c) => startNavigation(c)}
        onCheckinUpdate={(c) => setActiveCheckin(c)}
        onLocate={(c) => {
          // 地图模块内定位：弹窗关闭后直接飞向该打卡点（zoom 16）并保持标记高亮
          mapRef.current?.flyTo({
            center: [c.lng, c.lat],
            zoom: 16,
            duration: 900,
          });
          setLocatedCheckinId(c.id);
        }}
      />
    </div>
  );
}

// GPS 定位发光波纹蓝点 (参考 stamp-journey-main map-pulse + 用户需求 #00F2FE 品牌色)
// 三层结构：外围脉冲扩散环 + 中层发光光晕 + 内层白色边框蓝点
function UserLocationDot() {
  return (
    <div className="relative flex items-center justify-center w-8 h-8">
      {/* 1. 外围半透明脉冲扩散环 */}
      <div className="absolute w-8 h-8 bg-sky-400/30 rounded-full animate-ping"></div>
      {/* 2. 中层高亮发光光晕 */}
      <div className="absolute w-6 h-6 bg-sky-500/40 rounded-full blur-[2px]"></div>
      {/* 3. 内层白色边框蓝点 */}
      <div className="relative w-4 h-4 bg-brand border-2 border-white rounded-full shadow-[0_0_10px_#00F2FE]"></div>
    </div>
  );
}

// 足迹打卡照片 Marker (参考 stamp-journey-main checkInIcon)
// 白色硬边圆角框 + 极浅小投影：密集堆叠时阴影几乎不叠加，底图保持干净
function CheckinMarker({ checkin, active }: { checkin: Checkin; active: boolean }) {
  const catConfig = getCategoryConfig(checkin.category);
  const catColor = catConfig.markerColor || "#00BFA5";
  const size = active ? 58 : 50;

  return (
    <div
      className="map-photo-marker cursor-pointer"
      style={{ width: size, height: size }}
    >
      <div
        className="h-full w-full overflow-hidden bg-white"
        style={{
          borderRadius: 16,
          border: "2px solid #FFFFFF",
          boxShadow: `0 1px 2px rgba(15,23,42,0.15)${active ? `, 0 0 0 2px ${catColor}` : ""}`,
          transition: "transform .18s ease",
        }}
      >
        {checkin.image_url ? (
          // 图片渲染兼容多命名：
          // - base64 DataURL (data:image/...) → 直接 <img>
          // - 完整 https URL (https://...) → 直接 <img>（如 Unsplash 默认图）
          // - Supabase Storage 相对路径 → 走 SignedImage 签名
          checkin.image_url.startsWith("data:") || checkin.image_url.startsWith("http") ? (
            <img
              src={getOptimizedImageUrl(checkin.image_url)}
              alt={checkin.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <SignedImage
              path={checkin.image_url}
              alt={checkin.title}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `${catColor}30`, color: catColor }}
          >
            <catConfig.icon className="h-1/2 w-1/2" />
          </div>
        )}
      </div>
    </div>
  );
}
