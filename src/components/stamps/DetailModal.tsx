import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, Calendar, MapPin, User, Loader2, Trash2, AlertTriangle, Save, Pencil, Landmark, Leaf, Soup, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StampEntry, StampCategory } from "./types";
import { USER_STAMPS_KEY, stampDetailQueryOptions } from "@/lib/user-stamps";
import { compressImageToFile } from "@/lib/compress-image";
import { usePhotoUrl } from "@/components/signed-image";
import { getOptimizedImageUrl, isPrivateStorageUrl } from "@/lib/utils";
import { useI18n, useT } from "@/i18n";
import { MemberAvatar } from "@/components/member-avatar";
import {
  getLocalizedLocationText,
  getLocalizedLocationName,
} from "@/utils/location";

interface Props {
  entry: StampEntry;
  onClose: () => void;
  onDeleteSuccess?: (deletedId: string) => void;
  tripId: string;
}

function formatDate(iso: string, locale: string) {
  const d = new Date(iso);
  if (locale === "zh") {
    return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatStampDate(iso: string) {
  // 强制英文日期格式（忽略系统语言环境），示例：AUG 08, 2026
  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
      .format(new Date(iso))
      .toUpperCase();
  } catch {
    return iso;
  }
}

const perforationMask: React.CSSProperties = {
  ["--r" as string]: "7px",
  ["--g" as string]: "18px",
  WebkitMask: [
    "radial-gradient(circle var(--r) at var(--r) 0, #0000 98%, #000) repeat-x 0 0/var(--g) var(--r)",
    "radial-gradient(circle var(--r) at var(--r) 100%, #0000 98%, #000) repeat-x 0 100%/var(--g) var(--r)",
    "radial-gradient(circle var(--r) at 0 var(--r), #0000 98%, #000) repeat-y 0 0/var(--r) var(--g)",
    "radial-gradient(circle var(--r) at 100% var(--r), #0000 98%, #000) repeat-y 100% 0/var(--r) var(--g)",
    "linear-gradient(#000, #000) center / calc(100% - var(--r) * 2) calc(100% - var(--r) * 2) no-repeat",
  ].join(","),
  mask: [
    "radial-gradient(circle var(--r) at var(--r) 0, #0000 98%, #000) repeat-x 0 0/var(--g) var(--r)",
    "radial-gradient(circle var(--r) at var(--r) 100%, #0000 98%, #000) repeat-x 0 100%/var(--g) var(--r)",
    "radial-gradient(circle var(--r) at 0 var(--r), #0000 98%, #000) repeat-y 0 0/var(--r) var(--g)",
    "radial-gradient(circle var(--r) at 100% var(--r), #0000 98%, #000) repeat-y 100% 0/var(--r) var(--g)",
    "linear-gradient(#000, #000) center / calc(100% - var(--r) * 2) calc(100% - var(--r) * 2) no-repeat",
  ].join(","),
};

// 分类 Badge 配置 — 与 checkin-detail-sheet.tsx 保持一致
const CATEGORY_BADGE: Record<
  StampCategory,
  { Icon: typeof Landmark; labelKey: string; iconColor: string; border: string; bg: string; shadow: string }
> = {
  cities: {
    Icon: Landmark,
    labelKey: "category_cities",
    iconColor: "text-teal-700 dark:text-brand",
    border: "border-teal-600 dark:border-brand/50",
    bg: "bg-teal-50/90 dark:bg-brand/10",
    shadow: "shadow-[0_0_10px_rgba(0,242,254,0.3)]",
  },
  nature: {
    Icon: Leaf,
    labelKey: "category_nature",
    iconColor: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-600 dark:border-emerald-500/50",
    bg: "bg-emerald-50/90 dark:bg-emerald-500/10",
    shadow: "shadow-[0_0_10px_rgba(16,185,129,0.3)]",
  },
  food: {
    Icon: Soup,
    labelKey: "category_food",
    iconColor: "text-orange-600 dark:text-amber-400",
    border: "border-orange-500 dark:border-amber-500/50",
    bg: "bg-orange-50/90 dark:bg-amber-500/10",
    shadow: "shadow-[0_0_10px_rgba(245,158,11,0.3)]",
  },
};

export function DetailModal({ entry, onClose, onDeleteSuccess, tripId }: Props) {
  const { locale } = useI18n();
  const t = useT();
  const isEn = locale === "en";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 按需加载详情（notes 长文本在列表查询中被省略，打开弹窗时按 id 补齐）
  const { data: detail } = useQuery({
    ...stampDetailQueryOptions(entry.id),
  });
  // 合并：列表 entry（基本字段）+ 详情数据（notes）
  const resolvedNote = detail?.note ?? entry.note ?? "";

  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [note, setNote] = useState(resolvedNote);
  // 图片更换状态：photoFile 为压缩后的 File（待上传至 Storage），photoPreview 为本地预览 ObjectURL
  // 不再使用 Base64 — 保存时上传至 Supabase Storage，数据库仅存路径
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  // 编辑模式状态：默认浏览态，仅显示编辑按钮；进入编辑态后切换为删除+保存
  const [isEditing, setIsEditing] = useState(false);
  // 分类编辑状态：与地图打卡弹窗 (checkin-detail-sheet) 完全一致的下拉选择器
  const [category, setCategory] = useState<StampCategory>(entry.category);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const catMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(entry.title);
    setNote(detail?.note ?? entry.note ?? "");
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    setEditTitle(false);
    setSaved(false);
    setShowConfirmDelete(false);
    setIsEditing(false);
    setCategory(entry.category);
    setCatMenuOpen(false);
  }, [entry, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击外部关闭分类下拉菜单 — 与地图打卡弹窗逻辑一致
  useEffect(() => {
    if (!catMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (catMenuRef.current && !catMenuRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [catMenuOpen]);

  const currentCatBadge = CATEGORY_BADGE[category] || CATEGORY_BADGE.cities;
  const CurrentCatIcon = currentCatBadge.Icon;

  const hasChanges = title !== entry.title || note !== resolvedNote || photoFile !== null || category !== entry.category;

  const handlePhotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToFile(file);
      setPhotoFile(compressed);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error("Image compress failed:", err);
      alert(isEn ? "Image processing failed" : "图片处理失败");
    }
  }, [photoPreview, isEn]);

  const handleSave = useCallback(async () => {
    if (!tripId) return;
    // 安全校验：entry.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!entry.id) return;
    setSaving(true);

    try {
      // 1. 如有新图片：上传至 Supabase Storage，获取路径
      //    数据库仅存 Storage 相对路径，彻底废除 Base64
      let newPhotoPath: string | null = null;
      if (photoFile) {
        const userIdSeg = entry.creator.userId || "unknown";
        const filePath = `${tripId}/${userIdSeg}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("checkin-images")
          .upload(filePath, photoFile, {
            contentType: "image/jpeg",
            cacheControl: "3600000",
            upsert: false,
          });
        if (uploadError) throw uploadError;
        newPhotoPath = filePath;
      }

      // 2. 更新 user_stamps 表（含 photo_url 路径 + 分类）
      const updateData: Record<string, unknown> = { title, notes: note, category };
      if (newPhotoPath) updateData.photo_url = newPhotoPath;

      await (supabase as any).from("user_stamps").update(updateData).eq("id", entry.id);
      // 3. 同步更新 checkins 表（含分类）
      await (supabase as any).from("checkins").update({
        title,
        note,
        category,
        ...(newPhotoPath ? { image_url: newPhotoPath } : {}),
      }).eq("id", entry.id);

      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // 保存成功后退出编辑模式
      setIsEditing(false);
      setEditTitle(false);
      setCatMenuOpen(false);
      // 清空图片预览
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(null);
      setPhotoPreview(null);
    } catch (err) {
      console.error("Save failed:", err);
      alert(isEn ? "Save failed. Please try again." : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }, [entry.id, entry.creator.userId, title, note, category, photoFile, photoPreview, tripId, queryClient, isEn]);

  // Step 1: Click trash icon → show confirmation panel only
  const handleTrashClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirmDelete(true);
  };

  // Step 2: Cancel delete → hide confirmation panel
  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirmDelete(false);
  };

  // Step 3: Confirm delete → execute async delete, notify parent, then let parent close modal
  const confirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDeleting) return;

    // 安全校验：entry.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!entry.id) return;

    setIsDeleting(true);
    try {
      // 0. 先清理 Storage 中的图片文件（best-effort，不阻断删除流程）
      const photoPath = entry.photo;
      if (photoPath && !photoPath.startsWith("data:") && !photoPath.startsWith("http")) {
        try {
          await supabase.storage.from("checkin-images").remove([photoPath]);
        } catch (storageErr) {
          console.warn("[DetailModal] Storage 文件清理失败 (非关键):", storageErr);
        }
      }

      const { error: stampError } = await (supabase as any).from("user_stamps").delete().eq("id", entry.id);
      if (stampError) throw stampError;

      await (supabase as any).from("checkins").delete().eq("id", entry.id);

      // Notify parent to clean local state and close modal
      if (onDeleteSuccess) {
        onDeleteSuccess(entry.id);
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert(isEn ? "Delete failed. Please try again." : "删除失败，请重试。");
      setIsDeleting(false);
    }
  };

  // 当前展示的图片：编辑态优先显示新图预览（ObjectURL），否则用 usePhotoUrl 解析数据库值
  // usePhotoUrl 自动兼容 Base64 / http URL / Supabase Storage 路径三种格式
  const resolvedPhoto = usePhotoUrl(entry.photo);
  const displayPhoto = photoPreview || resolvedPhoto;
  // 位置胶囊：统一调用 getLocalizedLocationText 实现多语言自动切换
  // 与地图打卡详情弹窗 / 足迹网格卡片三处联动，确保中英文切换实时同步
  // 中文模式自动剥离 City/市 后缀 + 拼音扩展字典兜底（如 Hongqiao → 虹桥）
  const formattedLocation = getLocalizedLocationText(entry.city ?? "", entry.country ?? "", locale);

  // 邮票底部叠加标题：强制提取城市英文名并全大写
  // 必须且只能显示该打卡点对应的"城市名称"，与展示墙列表中的邮票保持一致
  // 不使用 entry.title（用户自定义标题，如 "TEST STAMP"），确保全 App 邮票下方第一行永远显示大写英文城市名
  const stampOverlayTitle =
    getLocalizedLocationName(entry.city ?? "", "en").toUpperCase() ||
    (isEn ? "UNTITLED" : "未命名");

  // 地图定位（百科同款）：关闭弹窗 → 切换至地图 Tab，坐标经 URL 直传（targetLat/targetLng + 时间戳 t），
  // 地图组件 onLoad 就绪后 flyTo(16) 精确飞行并高亮该打卡标记 —— 规避挂载期 mapRef 未绑定导致的静默失效
  const handleLocateOnMap = () => {
    const lat = detail?.lat;
    const lng = detail?.lng;
    if (!lat || !lng || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
      toast.error(isEn ? "No coordinates available for this stamp" : "暂无坐标，无法定位");
      return;
    }
    onClose();
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: {
        locate: entry.id,
        targetLat: String(lat),
        targetLng: String(lng),
        t: String(Date.now()),
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-card border border-slate-200 dark:border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 z-50 rounded-full bg-black/70 p-2 text-slate-100 shadow-lg ring-1 ring-border backdrop-blur transition hover:bg-black/90 hover:text-white">
          <X className="h-4 w-4" />
        </button>

        {/* 可滚动主体区域：pb-28 确保底部操作按钮不被 TabBar 遮挡 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700">
        {/* Postage Stamp Hero - 仅在编辑模式下可点击上传新图 */}
        <div className="relative flex items-center justify-center bg-gradient-to-b from-card via-card to-card px-6 pb-2 pt-10">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-3xl" />
          <label
            className={`relative rotate-[-3deg] transition-transform duration-500 ${isEditing ? "cursor-pointer hover:rotate-0" : "cursor-default"}`}
            style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))" }}
          >
            <div className="relative aspect-[4/5] w-52 p-0 bg-transparent dark:p-2.5 dark:bg-white sm:w-56" style={perforationMask}>
              <div className="relative h-full w-full overflow-hidden">
                {displayPhoto && !isPrivateStorageUrl(displayPhoto) ? (
                  <img
                    src={getOptimizedImageUrl(displayPhoto)}
                    alt={entry.title}
                    draggable={false}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  /* 骨架屏：私密图缓存解析中 / 兜底直链被拦截时显示脉冲动画占位 */
                  <div className="h-full w-full animate-pulse bg-gradient-to-br from-muted to-muted" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/40" />
                {/* 右上角：圆形印章边框 + 类别 Icon（已删除 PASSPORT 标签和 STAMPED 文字，
                    与 PostageStamp 标准组件统一） */}
                <div className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-white/70 bg-black/20 backdrop-blur-sm">
                  {(() => {
                    const CatIcon = CATEGORY_BADGE[category]?.Icon || Landmark;
                    return <CatIcon className="h-4 w-4 text-white/90" strokeWidth={2} />;
                  })()}
                </div>
                <div className="absolute inset-x-3 bottom-3 text-white">
                  <p className="font-serif text-lg font-bold leading-tight tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-xl">{stampOverlayTitle}</p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{formatStampDate(entry.createdAt)}</p>
                </div>
                {/* 仅编辑模式下显示更换图片提示层 + 相机 Icon */}
                {isEditing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity">
                    <div className="flex flex-col items-center gap-1 text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[10px] font-semibold uppercase tracking-wider">{t("stamps.changePhoto")}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* file input 始终挂载，但仅在编辑模式下可触发 */}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
              disabled={!isEditing}
            />
          </label>
        </div>

        <div className="p-6 pb-28">
          {/* Editable Title + 分类 Badge — 与地图模块 CheckinDetailSheet 结构一致 */}
          <div className="flex flex-wrap items-center gap-2">
            {isEditing && editTitle ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditTitle(false)}
                onKeyDown={(e) => e.key === "Enter" && setEditTitle(false)}
                autoFocus
                className="flex-1 rounded-lg border border-brand/60 bg-input px-3 py-2 text-xl font-bold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            ) : (
              <h2
                className={`flex-1 text-2xl font-bold text-slate-900 dark:text-foreground transition-colors ${isEditing ? "cursor-pointer hover:text-brand" : "cursor-default"}`}
                onClick={() => isEditing && setEditTitle(true)}
              >
                {title}
              </h2>
            )}
            {/* 分类选择器：浏览态只读胶囊，编辑态可点击下拉 — 与地图打卡弹窗完全一致 */}
            <div className="relative" ref={catMenuRef}>
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCatMenuOpen((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${currentCatBadge.border} ${currentCatBadge.bg} ${currentCatBadge.shadow}`}
                  >
                    <CurrentCatIcon className={`h-3.5 w-3.5 ${currentCatBadge.iconColor}`} />
                    <span className={currentCatBadge.iconColor}>{t(currentCatBadge.labelKey as Parameters<typeof t>[0])}</span>
                    <span className={`ml-0.5 text-[10px] opacity-70 transition-transform ${catMenuOpen ? "rotate-180" : ""}`}>▼</span>
                  </button>

                  {catMenuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-xl border border-border bg-card p-1 shadow-2xl">
                      {(Object.keys(CATEGORY_BADGE) as StampCategory[]).map((key) => {
                        const opt = CATEGORY_BADGE[key];
                        const OptIcon = opt.Icon;
                        const isActive = category === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setCategory(key);
                              setCatMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                              isActive
                                ? `${opt.bg} ${opt.iconColor} ring-1 ${opt.border}`
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            }`}
                          >
                            <OptIcon className={`h-4 w-4 ${isActive ? opt.iconColor : "text-muted-foreground"}`} />
                            <span className="flex-1 text-left">{t(opt.labelKey as Parameters<typeof t>[0])}</span>
                            {isActive && <Check className="h-3.5 w-3.5 opacity-80" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${currentCatBadge.border} ${currentCatBadge.bg} ${currentCatBadge.iconColor}`}
                >
                  <CurrentCatIcon className="h-3.5 w-3.5" />
                  {t(currentCatBadge.labelKey as Parameters<typeof t>[0])}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-slate-50 dark:bg-input p-3 ring-1 ring-slate-200 dark:ring-border">
            {/* 打卡人头像 — 全站统一 MemberAvatar（真实头像 → 专属色首字母圆） */}
            <div className="h-9 w-9 overflow-hidden rounded-full">
              <MemberAvatar
                fallbackId={entry.creator.userId}
                fallbackName={entry.creator.name}
                fallbackAvatar={entry.creator.avatar_url ?? null}
                textClassName="text-sm font-bold"
              />
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-muted-foreground">{t("footprints.checkedInBy")}</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-foreground">{entry.creator.name}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 text-xs text-slate-600 dark:text-muted-foreground">
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 dark:bg-input px-3 py-1.5 ring-1 ring-slate-200 dark:ring-border">
                <MapPin className="h-3.5 w-3.5 text-teal-600 dark:text-brand" />{formattedLocation}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 dark:bg-input px-3 py-1.5 ring-1 ring-slate-200 dark:ring-border">
                <Calendar className="h-3.5 w-3.5 text-teal-600 dark:text-brand" />{formatDate(entry.createdAt, locale)}
              </span>
            </div>
            {/* 黄色圆形地图定位按钮 — 百科同款 */}
            <button
              type="button"
              onClick={handleLocateOnMap}
              title={isEn ? "Locate on map" : "地图定位"}
              aria-label={isEn ? "Locate on map" : "地图定位"}
              className="ml-auto w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 active:scale-95 transition-all shadow-sm"
            >
              <MapPin className="h-4 w-4" />
            </button>
          </div>

          {/* Notes - 仅编辑模式下可修改 */}
          <div className="mt-6">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground">
              <User className="h-3 w-3" />{t("footprints.travelMemoriesByName", { name: entry.creator.name })}
            </label>
            {isEditing ? (
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setSaved(false); }}
                rows={4}
                placeholder="What do you remember about this place?"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 dark:border-border bg-white dark:bg-input p-3 text-sm text-slate-900 dark:text-foreground placeholder:text-slate-400 dark:placeholder:text-muted-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            ) : (
              <div className="mt-2 w-full resize-none rounded-xl border border-slate-200 dark:border-border bg-slate-50 dark:bg-input p-3 text-sm text-slate-900 dark:text-foreground">
                {note && note.trim() ? (
                  <p className="whitespace-pre-wrap">{note}</p>
                ) : (
                  <p className="italic text-slate-400 dark:text-muted-foreground">
                    {isEn ? "No memories recorded yet." : "暂无回忆记录。"}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action buttons - 右下角
             * 浏览模式: 仅显示编辑按钮 (Pencil)
             * 编辑模式: 显示删除按钮 (Trash2) + 保存按钮 (Save)
             */}
          <div className="mt-6 flex justify-end items-center gap-3">
            {!isEditing ? (
              /* 浏览模式: 仅显示编辑按钮 */
              <button
                onClick={() => setIsEditing(true)}
                aria-label={isEn ? "Edit" : "编辑"}
                title={isEn ? "Edit" : "编辑"}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-brand/40 bg-input text-brand transition-all hover:bg-brand/10 hover:scale-105"
              >
                <Pencil className="h-5 w-5" />
              </button>
            ) : (
              /* 编辑模式: 删除 + 保存 */
              <>
                {/* Delete area: icon or confirmation panel */}
                {showConfirmDelete ? (
                  <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-1.5">
                    <button
                      onClick={handleCancelDelete}
                      disabled={isDeleting}
                      className="rounded-lg px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/10"
                    >
                      {isEn ? "Cancel" : "取消"}
                    </button>
                    <button
                      onClick={confirmDelete}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/30"
                    >
                      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {isEn ? "Confirm" : "确认删除"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleTrashClick}
                    aria-label={isEn ? "Delete" : "删除"}
                    title={isEn ? "Delete" : "删除"}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400 transition-all hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Trash2 className="h-5 w-5 text-red-400" />
                  </button>
                )}

                <button
                  onClick={handleSave}
                  disabled={!hasChanges || saving}
                  aria-label={isEn ? "Save" : "保存"}
                  title={isEn ? "Save" : "保存"}
                  className="flex items-center justify-center rounded-full bg-brand p-3 shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin text-brand-foreground" /> : <Save className="w-5 h-5 text-brand-foreground" />}
                </button>
              </>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
