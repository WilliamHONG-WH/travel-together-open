import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  X,
  MapPin,
  Pencil,
  Save,
  Globe,
  MapPinned,
  AlertTriangle,
  Loader2,
  Camera,
  ImagePlus,
  ChevronDown,
  LocateFixed,
  Navigation,
  Trash2,
  CalendarDays,
  ExternalLink,
} from "lucide-react";
import { getDeepLinks, getDeepLinksBySearch, type MapAppLink } from "@/lib/navigation";
import type { Hotel } from "./hotelData";
import { formatStayDates } from "./hotelData";
import { useT, useI18n } from "@/i18n";
import { geocodeVenuePrecise } from "@/lib/geocode";
import {
  getLocalizedCountry,
  getLocalizedCity,
  getCitiesByCountry,
} from "@/constants/locations";
import { uploadImageToStorage } from "@/lib/compress-image";
import { LocationPickerModal } from "@/components/museum/MuseumDetail";
import { UnifiedCalendarGrid } from "@/components/unified-calendar";
import { PhotoImage } from "@/components/signed-image";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  hotel: Hotel | null;
  /** 新建模式：true 时强制进入编辑态并初始化空草稿 */
  isNew?: boolean;
  onClose: () => void;
  onSave: (updated: Hotel) => void;
  /** 删除回调：由父组件实现 Supabase 删除 + 刷新列表 */
  onDelete?: (id: string) => Promise<boolean>;
  /** 当前行程 ID — 用于 Storage 上传路径前缀 */
  tripId: string;
  /** 地图模块内弹窗的「一键定位」接管：就地飞行聚焦（规划模块走 ?hotel= 深链跳转） */
  onLocateOnMap?: () => void;
  /** 关闭按钮位置：地图模块传 'left' 避开右上角浮动卡片遮挡 */
  closeButtonPosition?: "left" | "right";
}

/**
 * 酒店新建/编辑弹窗 — 基于百科编辑弹窗（MuseumDetail）裁剪定制：
 * - 删除：导入按钮 / 外文名称副标题 / 核心展品 / 导览图
 * - 替换：开放时间 → 坐标（纬度/经度 + 自动定位图标，地址输入防抖自动正向地理编码）
 * - 新增：入住时间栏（从 [入住日期] 到 [退房日期]，复用 UnifiedCalendarGrid 日历弹窗）
 * - 修改：简介 → 备注（房型、预订号、早餐说明等）
 */
export function HotelEditModal({
  hotel,
  isNew = false,
  onClose,
  onSave,
  onDelete,
  tripId,
  onLocateOnMap,
  closeButtonPosition = "right",
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Hotel | null>(null);
  // 重新精准定位按钮的加载态
  const [locating, setLocating] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // 待上传封面 File — 保存时上传至 Storage，数据库仅存路径
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>("");
  const [isCompressingCover, setIsCompressingCover] = useState(false);
  // Location Picker 状态：null = 关闭，"country" / "city" = 选择对应字段
  const [pickerOpen, setPickerOpen] = useState<null | "country" | "city">(null);
  // 删除确认 / 未保存拦截弹窗
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  // 入住/退房日历弹窗状态（互不干扰，各自持有 viewDate/mode）
  const [checkInCalendarOpen, setCheckInCalendarOpen] = useState(false);
  const [checkOutCalendarOpen, setCheckOutCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"day" | "month" | "year">("day");
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(new Date());
  // 多地图导航 ActionSheet
  const [mapSheetOpen, setMapSheetOpen] = useState(false);
  const [navLinks, setNavLinks] = useState<MapAppLink[]>([]);
  // 进入编辑态时的快照，用于 isDirty 检测
  const [editInitialJson, setEditInitialJson] = useState<string>("");
  // 用户手动微调过坐标 → 暂停地址防抖自动回填
  const coordsDirtyRef = useRef(false);
  // 地址/名称/城市字段组合 key 快照，检测变化触发防抖地理编码
  const geoKeyRef = useRef<string>("");

  useEffect(() => {
    setDraft(hotel);
    setEditing(isNew);
    setCoverPreview(hotel?.cover || "");
    setCoverFile(null);
    coordsDirtyRef.current = false;
    geoKeyRef.current = "";
    setEditInitialJson(hotel ? JSON.stringify(hotel) : "");
  }, [hotel, isNew]);

  const updateField = <K extends keyof Hotel>(key: K, value: Hotel[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  // ========== 地址输入自动正向地理编码（防抖 1.2s）==========
  // 触发条件：编辑态下名称/地址/城市/国家任一变化，且用户未手动微调过坐标。
  // 命中后即时回填草稿坐标（保存时随 payload 一并写入 DB）。
  const geoKey =
    draft && editing
      ? `${draft.name}|${draft.address}|${draft.city}|${draft.country}`
      : "";
  useEffect(() => {
    if (!editing) {
      geoKeyRef.current = "";
      return;
    }
    // 首次进入编辑态：仅快照基准，不触发编码
    if (!geoKeyRef.current) {
      geoKeyRef.current = geoKey;
      return;
    }
    if (geoKeyRef.current === geoKey) return;
    geoKeyRef.current = geoKey;
    if (coordsDirtyRef.current) return;
    const timer = window.setTimeout(async () => {
      if (!draft) return;
      const geo = await geocodeVenuePrecise({
        name: draft.name,
        address: draft.address,
        cityKey: draft.city,
        countryKey: draft.country,
      });
      if (geo) {
        updateField("latitude", geo.lat);
        updateField("longitude", geo.lng);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey, editing]);

  // 触发封面文件选择器
  const handleCoverClick = () => {
    if (!editing) return;
    imageInputRef.current?.click();
  };

  // 读取封面文件：压缩为 File 并用 ObjectURL 即时预览，保存时上传至 Storage
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsCompressingCover(true);
    try {
      const { compressImageToFile } = await import("@/lib/compress-image");
      const compressed = await compressImageToFile(file);
      setCoverFile(compressed);
      setCoverPreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(isEn ? "Image processing failed" : "图片处理失败");
      setCoverPreview("");
      setCoverFile(null);
    } finally {
      setIsCompressingCover(false);
      if (e.target) e.target.value = "";
    }
  };

  // 重新精准定位：按当前表单的名称/地址手动触发三级建筑级地理编码
  const handleRelocate = async () => {
    if (!draft) return;
    setLocating(true);
    try {
      const geo = await geocodeVenuePrecise({
        name: draft.name,
        address: draft.address,
        cityKey: draft.city,
        countryKey: draft.country,
      });
      if (geo) {
        updateField("latitude", geo.lat);
        updateField("longitude", geo.lng);
        toast.success(
          isEn
            ? `Located: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
            : `定位成功: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`,
        );
      } else {
        toast.warning(
          isEn
            ? "No exact match found. Try a more detailed address."
            : "未匹配到具体坐标，请尝试更详细的地址。",
        );
      }
    } finally {
      setLocating(false);
    }
  };

  // ========== Esc 键全局拦截（日历 > Picker > 确认弹窗 > 主弹窗） ==========
  const escHandlerRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      escHandlerRef.current();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  if (!hotel || !draft) return null;

  // 备注空状态判定：空 / 纯空白 / 纯横杠均视为未填写（浏览态整块隐藏备注板块）
  const notesTrimmed = (draft.notes ?? "").trim();
  const hasNotes = notesTrimmed !== "" && !/^[-—–]+$/.test(notesTrimmed);

  escHandlerRef.current = () => {
    if (checkInCalendarOpen || checkOutCalendarOpen) {
      setCheckInCalendarOpen(false);
      setCheckOutCalendarOpen(false);
      return;
    }
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (pickerOpen) {
      setPickerOpen(null);
      return;
    }
    if (confirmDelete) {
      setConfirmDelete(false);
      return;
    }
    closeWithConfirm();
  };

  // isDirty：对比草稿 JSON 快照 + 封面文件变化
  const isDirty = editing && draft && (
    JSON.stringify(draft) !== editInitialJson || coverFile !== null
  );

  const closeWithConfirm = () => {
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const confirmDiscardEdit = () => {
    setConfirmDiscard(false);
    onClose();
  };

  const enterEditMode = () => {
    coordsDirtyRef.current = false;
    geoKeyRef.current = "";
    setEditInitialJson(draft ? JSON.stringify(draft) : "");
    setEditing(true);
  };

  /** 一键导航：有坐标走坐标深链，缺失时降级为地址搜索 */
  const handleOpenNavigation = (h: Hotel) => {
    const lat = h.latitude;
    const lng = h.longitude;
    const hasCoords =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    if (hasCoords) {
      setNavLinks(getDeepLinks({ lat: lat as number, lng: lng as number, title: h.name }));
    } else {
      const city = getLocalizedCity(h.city, locale, h.country);
      const query = [h.address, city].filter(Boolean).join(", ");
      if (!query) {
        toast.error(isEn ? "No location info, unable to navigate" : "暂无位置信息，无法导航");
        return;
      }
      setNavLinks(getDeepLinksBySearch(query));
    }
    setMapSheetOpen(true);
  };

  /**
   * 「一键跳转地图定位」（对齐百科 MuseumDetail 链路）：
   * - 地图模块内弹窗：父组件提供 onLocateOnMap 时由其接管（关闭弹窗 + 就地飞行）；
   * - 规划-酒店模块：跳转至地图模块（携带 ?hotel=<id> 深链，路由切换自动
   *   关闭当前弹窗），地图侧 flyTo(16) 聚焦并高亮该酒店标记。
   * 无坐标时给出双语提示，不跳转。
   */
  const handleLocateOnMap = () => {
    if (!draft) return;
    const lat = draft.latitude;
    const lng = draft.longitude;
    const hasCoords =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    if (!hasCoords) {
      toast.error(isEn ? "No coordinates yet, unable to locate" : "暂无坐标，无法定位");
      return;
    }
    if (onLocateOnMap) {
      onLocateOnMap();
      return;
    }
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: { hotel: draft.id },
    });
  };

  const commit = async () => {
    if (!draft) return;
    // 名称必填：防止空标题条目写入数据库后"丢失"
    if (!draft.name.trim()) {
      toast.error(isEn ? "Please enter the hotel name" : "请输入酒店名称");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // RLS 约束：checkin-images bucket 要求路径第二段 = auth.uid()
      const pathPrefix = `${tripId}/${user.id}`;

      // 移动端网络抖动兜底：上传失败自动重试一次（400ms 退避）
      const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch {
          await new Promise((r) => setTimeout(r, 400));
          return fn();
        }
      };

      // 酒店外观照属公共旅行参考资料（无隐私）：存入公开桶 public-images，
      // 数据库存完整公开直链（渲染端自动走 wsrv.nl CDN，0 Supabase Egress）。
      // 旧数据（checkin-images 相对路径）渲染时自动回落私密缓存链路，无需迁移。
      let coverPath = draft.cover;
      if (coverFile) {
        const p = await withRetry(() =>
          uploadImageToStorage(coverFile, pathPrefix, "public-images", { precompressed: true }),
        );
        coverPath = supabase.storage.from("public-images").getPublicUrl(p).data.publicUrl;
      }

      onSave({ ...draft, cover: coverPath });
      setEditing(false);
      setPickerOpen(null);
      setCoverFile(null);
    } catch (err) {
      console.error("Save failed:", err);
      const raw = err instanceof Error ? err.message : String(err);
      const reason =
        raw === "IMAGE_TOO_LARGE"
          ? isEn
            ? "Image too large (over 8MB) — please screenshot it and retry"
            : "图片过大（超过 8MB），请截图后重试"
          : raw || "Unknown error";
      toast.error(isEn ? `Save failed: ${reason}` : `保存失败：${reason}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft?.id || !onDelete) return;
    setDeleting(true);
    try {
      const ok = await onDelete(draft.id);
      if (ok) {
        setConfirmDelete(false);
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  };

  /** Location Picker 选中回调：联动城市/国家一致性 */
  const handlePick = (key: string) => {
    if (!draft) return;
    if (pickerOpen === "country") {
      const next: Hotel = { ...draft, country: key };
      const validCities = getCitiesByCountry(key).map((c) => c.key);
      if (!validCities.includes(next.city)) next.city = "";
      setDraft(next);
    } else if (pickerOpen === "city") {
      if (key.includes(":")) {
        const [countryKey, cityKey] = key.split(":");
        if (countryKey && cityKey) {
          setDraft({ ...draft, city: cityKey, country: draft.country || countryKey });
        }
      } else {
        setDraft({ ...draft, city: key });
      }
    }
    setPickerOpen(null);
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/30";

  // 日历触发按钮文案：未选日期时显示占位
  const dateLabel = (d: string) =>
    d ? formatStayDates(d) : isEn ? "Select Date" : "选择日期";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={closeWithConfirm}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-card border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeWithConfirm}
          aria-label="Close"
          className={`absolute top-4 z-50 ${
            closeButtonPosition === "left" ? "left-4" : "right-4"
          } bg-black/60 hover:bg-black/80 text-white rounded-full p-2 backdrop-blur-md transition`}
        >
          <X className="h-4 w-4" />
        </button>

        {/* 隐藏的文件选择框 */}
        <input
          type="file"
          ref={imageInputRef}
          onChange={handleImageChange}
          accept="image/*"
          className="hidden"
        />

        {/* 可滚动主体区域：父容器 divide-y 统一管理分割线 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700 divide-y divide-border">
          {/* 封面图片区域：浏览态点击放大预览，编辑态点击更换图片 */}
          <div
            onClick={editing ? handleCoverClick : undefined}
            className={`relative w-full h-56 sm:h-64 overflow-hidden bg-muted ${
              editing ? "cursor-pointer group" : ""
            }`}
          >
            {coverPreview || draft.cover ? (
              <>
                <PhotoImage
                  src={editing ? coverPreview || draft.cover : draft.cover}
                  alt={draft.name || "Hotel Cover"}
                  className={`w-full h-full object-cover ${editing ? "group-hover:scale-105 transition-transform duration-300" : ""}`}
                />
                {isCompressingCover && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5 z-20">
                    <Loader2 className="w-6 h-6 text-brand animate-spin" />
                    <span className="text-[10px] text-brand font-medium">
                      {isEn ? "Compressing..." : "压缩中..."}
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                {editing && (
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-brand font-semibold text-sm">
                    <Camera className="w-5 h-5" />
                    <span>{isEn ? "Change Cover" : "更换封面图片"}</span>
                  </div>
                )}
              </>
            ) : (
              /* 无图片时的虚线占位区域 */
              <div className="w-full h-full border-2 border-dashed border-border hover:border-brand/80 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-brand">
                <ImagePlus className="w-8 h-8" />
                <span className="text-xs">
                  {editing
                    ? isEn ? "Click to upload cover image" : "点击上传封面图片"
                    : ""}
                </span>
              </div>
            )}
          </div>

          {/* 顶部操作工具栏（对齐票据/百科模块 Action Bar）— 酒店为已确定住宿，无收藏功能 */}
          <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-3.5 bg-card shrink-0">
            {/* 右侧：操作按钮组 (红色删除 + 青色保存 / 浏览态铅笔编辑) */}
            <div className="flex items-center gap-3">
              {editing ? (
                <>
                  {editing && !isNew && onDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete"
                      title={isEn ? "Delete this hotel" : "删除此酒店"}
                      className="p-3 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all active:scale-95 flex items-center justify-center shadow-lg"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={commit}
                    disabled={saving || isCompressingCover}
                    aria-label="Save"
                    title={isEn ? "Save" : "保存"}
                    className="p-3 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold transition-all active:scale-95 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.5)] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  </button>
                </>
              ) : (
                <button
                  onClick={enterEditMode}
                  aria-label="Edit Content"
                  title={isEn ? "Edit" : "编辑"}
                  className="p-2.5 rounded-full bg-brand/10 border border-brand/50 text-brand transition-all hover:bg-brand/20 flex items-center justify-center"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* 标题输入栏 */}
          <div className="px-5 py-3 sm:px-6">
            <div className="flex justify-between items-center w-full">
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <label className="text-[10px] font-bold text-brand tracking-wider uppercase">
                  {isEn ? "Hotel Name / Title" : "酒店名称 / 标题"}
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder={isEn ? "Enter hotel name..." : "输入酒店名称..."}
                    className="w-full bg-input border border-border/80 rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:border-brand outline-none"
                  />
                ) : (
                  <h2 className="text-lg font-bold text-foreground">{draft.name}</h2>
                )}
              </div>
              {/* 浏览态：导航圆圈按钮 + 黄色地图定位按钮（对齐百科双按钮样式） */}
              {!editing && (
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  {/* 1. 导航按钮（排在左侧） */}
                  <button
                    type="button"
                    onClick={() => handleOpenNavigation(draft)}
                    aria-label="Navigate"
                    title={isEn ? "Navigate" : "一键导航"}
                    className="w-9 h-9 rounded-full flex items-center justify-center border border-teal-500/40 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 active:scale-95 transition-all shadow-sm"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>

                  {/* 2. 黄色地图定位按钮（排在右侧）— 跳转地图模块 flyTo 聚焦 */}
                  <button
                    type="button"
                    onClick={handleLocateOnMap}
                    aria-label="Locate on Map"
                    title={isEn ? "Locate on map" : "地图定位"}
                    className="w-9 h-9 rounded-full flex items-center justify-center border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 active:scale-95 transition-all shadow-sm"
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 城市/国家选择器行 */}
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-6">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => setPickerOpen("city")}
                  className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-brand transition hover:border-brand/70 hover:bg-brand/10"
                >
                  <MapPinned className="h-3 w-3" />
                  {draft.city
                    ? getLocalizedCity(draft.city, locale, draft.country)
                    : isEn ? "City" : "城市"}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen("country")}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground transition hover:border-brand/40 hover:text-foreground"
                >
                  <Globe className="h-3 w-3" />
                  {draft.country
                    ? getLocalizedCountry(draft.country, locale)
                    : isEn ? "Country" : "国家"}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </>
            ) : (
              <>
                <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand ring-1 ring-brand/30">
                  {getLocalizedCity(draft.city, locale, draft.country)}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                  {getLocalizedCountry(draft.country, locale)}
                </span>
              </>
            )}
          </div>

          {/* 地址 + 坐标（原"开放时间"位置替换为坐标栏） */}
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 sm:px-6">
            <InfoRow icon={<MapPin className="h-4 w-4 text-brand" />} label={isEn ? "Address" : "地址"}>
              {editing ? (
                <input
                  value={draft.address}
                  onChange={(e) => updateField("address", e.target.value)}
                  placeholder={isEn ? "Street, number..." : "街道、门牌号..."}
                  className={inputCls}
                />
              ) : (
                <p className="text-sm text-foreground">{draft.address || "—"}</p>
              )}
            </InfoRow>
            <InfoRow icon={<LocateFixed className="h-4 w-4 text-brand" />} label={isEn ? "Coordinates" : "坐标"}>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.latitude ?? ""}
                    onChange={(e) => {
                      coordsDirtyRef.current = true;
                      const v = parseFloat(e.target.value);
                      updateField("latitude", e.target.value.trim() !== "" && isFinite(v) ? v : undefined);
                    }}
                    placeholder={isEn ? "Latitude" : "纬度"}
                    className={`${inputCls} px-2 py-1.5 text-xs`}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.longitude ?? ""}
                    onChange={(e) => {
                      coordsDirtyRef.current = true;
                      const v = parseFloat(e.target.value);
                      updateField("longitude", e.target.value.trim() !== "" && isFinite(v) ? v : undefined);
                    }}
                    placeholder={isEn ? "Longitude" : "经度"}
                    className={`${inputCls} px-2 py-1.5 text-xs`}
                  />
                  {/* 自动定位图标：按当前名称/地址手动触发三级建筑级地理编码 */}
                  <button
                    type="button"
                    title={isEn ? "Auto-locate" : "自动定位"}
                    disabled={locating}
                    onClick={handleRelocate}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-brand shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                  >
                    {locating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LocateFixed className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-foreground">
                  {draft.latitude != null && draft.longitude != null
                    ? `${draft.latitude.toFixed(5)}, ${draft.longitude.toFixed(5)}`
                    : "—"}
                </p>
              )}
            </InfoRow>
          </div>

          {/* 入住时间栏 (Stay Dates)：从 [入住日期] 到 [退房日期]（备注隐藏时为末尾板块） */}
          <div className={`px-5 py-4 sm:px-6 ${editing || hasNotes ? "" : "pb-28"}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-brand" />
              {isEn ? "Stay Dates" : "入住时间"}
            </div>
            {editing ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* 入住日期：呼出与行程规划完全相同的日历弹窗 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarViewDate(draft.checkInDate ? new Date(draft.checkInDate + "T00:00:00") : new Date());
                      setCheckInCalendarOpen(true);
                    }}
                    className="flex h-9 items-center justify-between gap-2 rounded-lg border border-border bg-input px-3 text-left text-xs text-foreground transition-all hover:border-brand/40"
                  >
                    <span>{dateLabel(draft.checkInDate)}</span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>
                  {checkInCalendarOpen && (
                    <UnifiedCalendarGrid
                      mode={calendarMode}
                      viewDate={calendarViewDate}
                      selectedDateStr={draft.checkInDate}
                      setMode={setCalendarMode}
                      setViewDate={setCalendarViewDate}
                      onSelectDate={(dateStr) => {
                        updateField("checkInDate", dateStr);
                        setCheckInCalendarOpen(false);
                      }}
                      labelText={isEn ? "CHECK-IN" : "入住日期"}
                      isEn={isEn}
                      mobileOverlay
                      onClose={() => setCheckInCalendarOpen(false)}
                    />
                  )}
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "to" : "到"}
                </span>
                {/* 退房日期 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarViewDate(draft.checkOutDate ? new Date(draft.checkOutDate + "T00:00:00") : new Date());
                      setCheckOutCalendarOpen(true);
                    }}
                    className="flex h-9 items-center justify-between gap-2 rounded-lg border border-border bg-input px-3 text-left text-xs text-foreground transition-all hover:border-brand/40"
                  >
                    <span>{dateLabel(draft.checkOutDate)}</span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>
                  {checkOutCalendarOpen && (
                    <UnifiedCalendarGrid
                      mode={calendarMode}
                      viewDate={calendarViewDate}
                      selectedDateStr={draft.checkOutDate}
                      setMode={setCalendarMode}
                      setViewDate={setCalendarViewDate}
                      onSelectDate={(dateStr) => {
                        updateField("checkOutDate", dateStr);
                        setCheckOutCalendarOpen(false);
                      }}
                      labelText={isEn ? "CHECK-OUT" : "退房日期"}
                      isEn={isEn}
                      mobileOverlay
                      onClose={() => setCheckOutCalendarOpen(false)}
                    />
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-sm font-medium text-foreground">
                {formatStayDates(draft.checkInDate, draft.checkOutDate) || "—"}
              </p>
            )}
          </div>

          {/* 备注 (Notes) — 原"简介"板块改造：记录房型、预订号、早餐说明等
              浏览态未填写（空/纯空白/横杠）时整块隐藏（含标题与分割线），以入住时间收尾 */}
          {(editing || hasNotes) && (
            <div className="px-5 py-5 pb-28 sm:px-6">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                {isEn ? "Notes" : "备注"}
              </h3>
              {editing ? (
                <textarea
                  value={draft.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  rows={6}
                  placeholder={
                    isEn
                      ? "Room type, booking number, breakfast details..."
                      : "房型、预订号、早餐说明..."
                  }
                  className={`${inputCls} mt-3`}
                />
              ) : (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
                  {draft.notes}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Location Picker Modal：通过 Portal 渲染到 body */}
      {pickerOpen && draft &&
        createPortal(
          <LocationPickerModal
            mode={pickerOpen}
            locale={locale}
            currentCountryKey={draft.country}
            currentCityKey={draft.city}
            onPick={handlePick}
            onClose={() => setPickerOpen(null)}
          />,
          document.body,
        )}

      {/* 删除确认弹窗 */}
      {confirmDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => !deleting && setConfirmDelete(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/40">
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Delete this hotel?" : "确认删除此酒店？"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "This will permanently remove the hotel and all its data. This action cannot be undone."
                    : "将永久删除该酒店的全部信息，此操作不可撤销。"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80 disabled:opacity-50"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-bold text-white transition hover:bg-rose-600 disabled:opacity-50"
                  >
                    {deleting
                      ? isEn ? "Deleting..." : "删除中..."
                      : isEn ? "Delete" : "确认删除"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 未保存修改警告弹窗 */}
      {confirmDiscard &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setConfirmDiscard(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/40">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {isEn ? "Unsaved Changes" : "有未保存的修改"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isEn
                    ? "You have unsaved changes to this hotel. Discard them and exit?"
                    : "该酒店有未保存的修改，确定放弃并退出吗？"}
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <button
                    onClick={() => setConfirmDiscard(false)}
                    className="flex-1 rounded-xl bg-muted py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/80"
                  >
                    {isEn ? "Cancel" : "取消"}
                  </button>
                  <button
                    onClick={confirmDiscardEdit}
                    className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600"
                  >
                    {isEn ? "Discard" : "确认放弃"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 多地图导航 ActionSheet */}
      {mapSheetOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[1300] flex animate-in fade-in duration-200 items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setMapSheetOpen(false)}
          >
            <div
              className="relative w-full max-w-lg rounded-t-3xl border border-border/60 bg-card p-0 shadow-2xl animate-in slide-in-from-bottom duration-300 sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setMapSheetOpen(false)}
                aria-label="Close"
                className="absolute right-4 top-4 rounded-full bg-muted p-1.5 text-muted-foreground transition-all hover:text-foreground active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="px-5 pt-4">
                <h3 className="text-base font-semibold text-foreground">{t("nav.chooseMap")}</h3>
              </div>
              <div className="mx-auto w-full max-w-lg space-y-2 px-5 pb-6 pt-3">
                {navLinks.map((link) => (
                  <a
                    key={link.labelKey}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMapSheetOpen(false)}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 active:scale-[0.99]"
                  >
                    {t(link.labelKey)}
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// —— 内联小组件 ——

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
