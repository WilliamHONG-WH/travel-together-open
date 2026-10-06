import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { stampDetailQueryOptions } from "@/lib/user-stamps";
import { createPortal } from "react-dom";
import {
  Loader2,
  MapPin,
  Share2,
  X,
  Navigation,
  Calendar,
  User,
  Trash2,
  AlertTriangle,
  Save,
  Pencil,
  Landmark,
  Leaf,
  Soup,
  Check,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SignedImage } from "@/components/signed-image";
import { getOptimizedImageUrl } from "@/lib/utils";
import { shareCheckinToChat } from "@/lib/messages";
import { compressImageToFile } from "@/lib/compress-image";
import { checkinsQueryOptions, type Checkin } from "@/lib/checkins";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { MemberAvatar } from "@/components/member-avatar";
import { supabase } from "@/integrations/supabase/client";
import { useT, useI18n } from "@/i18n";
import { USER_STAMPS_KEY } from "@/lib/user-stamps";
import {
  getLocalizedLocationText,
  getLocalizedLocationName,
} from "@/utils/location";

// 3 分类系统 — 与足迹模块 (stamps/types.ts) 100% 对齐
type StampCategory = "cities" | "nature" | "food";

type CategoryOption = {
  key: StampCategory;
  labelKey: "category_cities" | "category_nature" | "category_food";
  Icon: typeof Landmark;
  iconColor: string;
  border: string;
  bg: string;
  shadow: string;
  hex: string; // 用于内联 style 的纯色值（无图占位背景/前景色）
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    key: "cities",
    labelKey: "category_cities",
    Icon: Landmark,
    iconColor: "text-teal-700 dark:text-brand",
    border: "border-teal-600 dark:border-brand/50",
    bg: "bg-teal-50/90 dark:bg-brand/10",
    shadow: "shadow-[0_0_10px_rgba(0,242,254,0.3)]",
    hex: "#00F2FE",
  },
  {
    key: "nature",
    labelKey: "category_nature",
    Icon: Leaf,
    iconColor: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-600 dark:border-emerald-500/50",
    bg: "bg-emerald-50/90 dark:bg-emerald-500/10",
    shadow: "shadow-[0_0_10px_rgba(16,185,129,0.3)]",
    hex: "#10B981",
  },
  {
    key: "food",
    labelKey: "category_food",
    Icon: Soup,
    iconColor: "text-orange-600 dark:text-amber-400",
    border: "border-orange-500 dark:border-amber-500/50",
    bg: "bg-orange-50/90 dark:bg-amber-500/10",
    shadow: "shadow-[0_0_10px_rgba(245,158,11,0.3)]",
    hex: "#F59E0B",
  },
];

// 兼容旧的 4 分类数据 (attraction/restaurant/shop/scenery) → 新 3 分类
function normalizeCategory(cat: string | null | undefined): StampCategory {
  if (cat === "cities" || cat === "nature" || cat === "food") return cat;
  if (cat === "restaurant") return "food";
  if (cat === "scenery") return "nature";
  // attraction / shop / 未知 → cities
  return "cities";
}

function getCategoryOption(cat: string | null | undefined): CategoryOption {
  const normalized = normalizeCategory(cat);
  return CATEGORY_OPTIONS.find((o) => o.key === normalized) ?? CATEGORY_OPTIONS[0];
}

// 邮票齿孔遮罩 — 与 stamps/DetailModal.tsx 100% 一致
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

function formatDate(iso: string, locale: string) {
  const d = new Date(iso);
  if (locale === "zh") {
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export function CheckinDetailSheet({
  checkin,
  tripId,
  currentUserId,
  onOpenChange,
  onShared,
  onNavigate,
  onCheckinUpdate,
  onLocate,
}: {
  checkin: Checkin | null;
  tripId: string;
  currentUserId: string | null;
  onOpenChange: (open: boolean) => void;
  onShared: () => void;
  onNavigate: (c: Checkin) => void;
  onCheckinUpdate?: (c: Checkin) => void;
  /** 地图定位按钮：弹窗关闭后由父组件执行 flyTo(16) 聚焦该打卡点 */
  onLocate?: (c: Checkin) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const queryClient = useQueryClient();

  const isCreator = !!checkin && !!currentUserId && checkin.user_id === currentUserId;

  // 外部地图导航选择弹窗
  const [showNavPicker, setShowNavPicker] = useState(false);

  // 拉取 trip 成员以渲染 "Checked in by" 胶囊
  // 父组件 TripMap 已 useSuspenseQuery 过同一 query key，此处命中缓存即时返回
  const { data: members = [] } = useQuery({
    ...tripMembersQueryOptions(tripId),
    enabled: !!checkin,
  });

  const creatorInfo = useMemo(() => {
    if (!checkin) return null;
    return members.find((m) => m.user_id === checkin.user_id) ?? null;
  }, [members, checkin]);

  const creatorName = creatorInfo?.display_name || (isEn ? "Traveler" : "旅行者");

  // 按需加载详情（notes 长文本在列表查询中被省略，打开弹窗时按 id 补齐）
  const { data: detail } = useQuery({
    ...stampDetailQueryOptions(checkin?.id ?? ""),
    enabled: !!checkin?.id,
  });
  // 合并：列表数据（基本字段）+ 详情数据（notes）
  const fullCheckin = useMemo<Checkin | null>(() => {
    if (!checkin) return null;
    if (detail) return detail;
    return checkin;
  }, [checkin, detail]);

  // ─── 编辑模式状态 ───────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<StampCategory>("cities");
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  // 新增: 图片更换状态
  // photoFile 为压缩后的 File 对象（待上传至 Storage），photoPreview 为本地预览 ObjectURL
  // 不再使用 Base64 — 保存时上传至 Supabase Storage，数据库仅存路径
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const catMenuRef = useRef<HTMLDivElement>(null);

  // 当 checkin 切换时，重置所有编辑状态并同步 note/category/photo
  useEffect(() => {
    if (checkin) {
      setIsEditing(false);
      setNote(fullCheckin?.note ?? "");
      setCategory(normalizeCategory(checkin.category));
      setCatMenuOpen(false);
      setShowConfirmDelete(false);
      setIsDeleting(false);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(null); // 重置图片预览
      setPhotoPreview(null);
    }
  }, [checkin?.id]); // 仅依赖 id，避免 note 变化触发重置

  // 图片更换处理 — 先前端压缩为 File (≤300KB)，再用 ObjectURL 即时预览
  // 保存时上传至 Supabase Storage，数据库仅存路径，彻底废除 Base64
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsCompressingPhoto(true);
    try {
      const compressed = await compressImageToFile(file);
      setPhotoFile(compressed);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(t("checkin.imageFailed", { defaultValue: "图片处理失败" }));
    } finally {
      setIsCompressingPhoto(false);
    }
  };

  // 当前展示的图片：编辑态优先显示用户选中的新图预览，否则显示数据库中的 image_url
  const displayPhoto = photoPreview ?? checkin?.image_url ?? null;

  // 点击外部关闭分类下拉菜单
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

  const currentCatOption = getCategoryOption(category);
  const CurrentCatIcon = currentCatOption.Icon;

  // ─── Mutations ─────────────────────────────────────────────
  const share = useMutation({
    mutationFn: async () => {
      if (!checkin) throw new Error(t("chat.noCheckinData"));
      if (!currentUserId) throw new Error(t("checkin.notLoggedIn"));
      return shareCheckinToChat({
        tripId,
        userId: currentUserId,
        checkin: { id: checkin.id, title: checkin.title },
      });
    },
    onSuccess: () => {
      toast.success(t("chat.sharedToChat"));
      onOpenChange(false);
      onShared();
    },
    onError: (e: any) => toast.error(e?.message ?? t("chat.shareFailed")),
  });

  // 保存：同时更新 checkins 与 user_stamps（与 stamps/DetailModal 数据流 100% 一致）
  // - checkins.image_url ↔ user_stamps.photo_url 同步写入
  // - 保存后立即失效 query cache，确保足迹/地图两侧刷新后看到同一张图
  const handleSave = async () => {
    if (!checkin || saving) return;
    // 安全校验：checkin.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!checkin.id) return;
    setSaving(true);
    try {
      // 1. 如有新图片：上传至 Supabase Storage，获取路径
      //    数据库仅存 Storage 相对路径，彻底废除 Base64
      let newPhotoPath: string | null = null;
      if (photoFile) {
        const filePath = `${tripId}/${checkin.user_id}/${crypto.randomUUID()}.jpg`;
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

      // 2. 更新 checkins 表（含 image_url 路径）
      const checkinUpdate: Record<string, unknown> = { category, note };
      if (newPhotoPath) checkinUpdate.image_url = newPhotoPath;
      const { error: cErr } = await (supabase as any)
        .from("checkins")
        .update(checkinUpdate)
        .eq("id", checkin.id);
      if (cErr) throw cErr;

      // 3. 同步更新 user_stamps 表（含 photo_url 路径）
      const stampUpdate: Record<string, unknown> = { category, notes: note };
      if (newPhotoPath) stampUpdate.photo_url = newPhotoPath;
      await (supabase as any)
        .from("user_stamps")
        .update(stampUpdate)
        .eq("id", checkin.id);

      // 4. 失效相关查询缓存
      queryClient.invalidateQueries({ queryKey: checkinsQueryOptions(tripId).queryKey });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });
      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });

      // 5. 乐观更新父组件状态（含新图路径）
      onCheckinUpdate?.({
        ...checkin,
        category,
        note,
        ...(newPhotoPath ? { image_url: newPhotoPath } : {}),
      });

      toast.success(isEn ? "Saved" : "已保存");
      setIsEditing(false);
      setCatMenuOpen(false);
      // 清空预览，下次进入编辑态重新选图
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(null);
      setPhotoPreview(null);
    } catch (err) {
      console.error("Save failed:", err);
      toast.error(isEn ? "Save failed. Please try again." : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const handleTrashClick = () => {
    setShowConfirmDelete(true);
  };

  const handleCancelDelete = () => {
    setShowConfirmDelete(false);
  };

  const confirmDelete = async () => {
    if (isDeleting || !checkin) return;
    // 安全校验：checkin.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!checkin.id) return;
    setIsDeleting(true);
    try {
      // 0. 先清理 Storage 中的图片文件（best-effort，不阻断删除流程）
      // 仅当 image_url 是 Storage 相对路径（非 data:/非 http）时才清理
      const photoPath = checkin.image_url;
      if (photoPath && !photoPath.startsWith("data:") && !photoPath.startsWith("http")) {
        try {
          await supabase.storage.from("checkin-images").remove([photoPath]);
        } catch (storageErr) {
          console.warn("[CheckinDetailSheet] Storage 文件清理失败 (非关键):", storageErr);
        }
      }

      // 1. 先删除主数据源 user_stamps（必须成功）
      // checkin.id 实际来自 user_stamps.id（见 lib/user-stamps.ts 的 row.id 映射）
      const { error: stampErr } = await (supabase as any)
        .from("user_stamps")
        .delete()
        .eq("id", checkin.id);
      if (stampErr) throw stampErr;

      // 2. 再删除 checkins 表（legacy 兼容，best-effort 不抛错）
      // checkins 表在创建时就是"非关键"插入（见 checkin-modal.tsx L168-170），
      // 可能没有对应记录或 RLS 限制，删除失败不影响主流程
      try {
        await supabase.from("checkins").delete().eq("id", checkin.id);
      } catch (legacyErr) {
        console.warn("[CheckinDetailSheet] checkins 表删除失败 (非关键):", legacyErr);
      }

      // 3. 失效所有相关查询缓存，触发地图 + 足迹模块重新拉取
      queryClient.invalidateQueries({ queryKey: checkinsQueryOptions(tripId).queryKey });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });
      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });

      toast.success(isEn ? "Check-in deleted" : "打卡已删除");
      onOpenChange(false);
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error(isEn ? "Delete failed. Please try again." : "删除失败，请重试。");
      setIsDeleting(false);
    }
  };

  // 用于邮票底部叠加的标题：强制提取城市英文名并全大写
  // 必须且只能显示该打卡点对应的"城市名称"，与展示墙列表中的邮票保持一致
  // 不使用 checkin.title（用户自定义标题，如 "TEST STAMP"），确保全 App 邮票下方第一行永远显示大写英文城市名
  const stampOverlayTitle =
    getLocalizedLocationName(checkin?.city ?? "", "en").toUpperCase() ||
    (isEn ? "UNTITLED" : "未命名");

  // 位置胶囊：100% 屏蔽 lat/lng 坐标，仅显示 city, country
  // 统一调用 getLocalizedLocationText 实现多语言自动切换（与足迹卡片 / 足迹弹窗三处联动）：
  //   - 中文模式：`洛杉矶，美国`（使用中文逗号，自动剥离 City/市 后缀 + 拼音扩展字典）
  //   - 英文模式：`Los Angeles, United States`（使用英文逗号 + 空格）
  // 若 city/country 均缺失，使用有意义的地名 fallback 而非坐标数字
  const formattedLocation = checkin
    ? getLocalizedLocationText(checkin.city ?? "", checkin.country ?? "", locale)
    : "";

  const hasChanges =
    !!checkin &&
    (note !== (checkin.note ?? "") ||
      category !== normalizeCategory(checkin.category) ||
      photoFile !== null);

  return (
    <>
    <Sheet open={!!checkin} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // 隐藏 Sheet 自带的 X 关闭按钮，使用自定义的右上方 X 按钮与足迹弹窗一致
        className="border-0 bg-transparent p-0 [&>button[data-radix-collection-item]]:hidden sm:max-w-lg sm:mx-auto"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{checkin?.title ?? t("checkinDetail.title")}</SheetTitle>
        </SheetHeader>
        {checkin && (
          <div className="relative mx-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700 rounded-t-3xl border border-brand/20 bg-card/90 shadow-[0_0_60px_rgba(0,191,165,0.15)] backdrop-blur-xl sm:rounded-3xl">
            {/* 右上角自定义 X 关闭按钮 — 与 stamps/DetailModal 一致 */}
            <button
              onClick={() => onOpenChange(false)}
              aria-label={t("common.close")}
              className="absolute right-4 top-4 z-50 rounded-full bg-black/70 p-2 text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-black/90 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Postage Stamp Hero — 立柱邮票 / 撕边照片质感框
                * 编辑模式下整张图可点击触发 file input 更换图片（与足迹模块一致）
                * 数据流: photo(base64 预览) → 保存时写入 checkins.image_url + user_stamps.photo_url
                */}
            <div className="relative flex items-center justify-center bg-card px-6 pb-2 pt-10">
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-3xl" />
              <label
                className={`relative rotate-[-3deg] transition-transform duration-500 ${isEditing ? "cursor-pointer hover:rotate-0" : "cursor-default"}`}
                style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))" }}
              >
                <div
                  className="relative aspect-[4/5] w-52 p-0 bg-transparent dark:p-2.5 dark:bg-white sm:w-56"
                  style={perforationMask}
                >
                  <div className="relative h-full w-full overflow-hidden">
                    {displayPhoto ? (
                      // 图片渲染兼容多命名（与 CheckinMarker 一致）：
                      // - base64 DataURL (data:image/...) → 直接 <img>
                      // - 完整 https URL (https://...) → 直接 <img>（如 Unsplash 默认图）
                      // - Supabase Storage 相对路径 → 走 SignedImage 签名
                      displayPhoto.startsWith("data:") || displayPhoto.startsWith("http") ? (
                        <img
                          src={getOptimizedImageUrl(displayPhoto)}
                          alt={checkin?.title ?? ""}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <SignedImage
                          path={displayPhoto}
                          alt={checkin?.title ?? ""}
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{
                          background: `${currentCatOption.hex}30`,
                          color: currentCatOption.hex,
                        }}
                      >
                        <CurrentCatIcon className="h-1/2 w-1/2" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/40" />
                    {/* 右上角：圆形印章边框 + 类别 Icon（已删除 PASSPORT 标签和 STAMPED 文字，
                        与 PostageStamp 标准组件统一） */}
                    <div className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-white/70 bg-black/20 backdrop-blur-sm">
                      <CurrentCatIcon className="h-4 w-4 text-white/90" strokeWidth={2} />
                    </div>
                    <div className="absolute inset-x-3 bottom-3 text-white">
                      <p className="font-serif text-lg font-bold leading-tight tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-xl">
                        {stampOverlayTitle.toUpperCase()}
                      </p>
                      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                        {formatStampDate(checkin.created_at)}
                      </p>
                    </div>
                    {/* 仅编辑模式下显示更换图片提示层 + Camera Icon */}
                    {isEditing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity">
                        <div className="flex flex-col items-center gap-1 text-white">
                          <Camera className="h-7 w-7" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider">
                            {isEn ? "Change Photo" : "更换图片"}
                          </span>
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
              {/* 标题 + 分类胶囊/下拉框 */}
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex-1 text-2xl font-bold text-foreground">{checkin.title}</h2>

                {/* 分类选择器：浏览态只读胶囊，编辑态可点击下拉 */}
                <div className="relative" ref={catMenuRef}>
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setCatMenuOpen((v) => !v)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${currentCatOption.border} ${currentCatOption.bg} ${currentCatOption.shadow}`}
                      >
                        <CurrentCatIcon className={`h-3.5 w-3.5 ${currentCatOption.iconColor}`} />
                        <span className={currentCatOption.iconColor}>{t(currentCatOption.labelKey)}</span>
                        <span className={`ml-0.5 text-[10px] opacity-70 transition-transform ${catMenuOpen ? "rotate-180" : ""}`}>▼</span>
                      </button>

                      {catMenuOpen && (
                        <div className="absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-xl border border-border bg-card/95 p-1 shadow-2xl backdrop-blur-xl">
                          {CATEGORY_OPTIONS.map((opt) => {
                            const OptIcon = opt.Icon;
                            const isActive = category === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => {
                                  setCategory(opt.key);
                                  setCatMenuOpen(false);
                                }}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                                  isActive
                                    ? `${opt.bg} ${opt.iconColor} ring-1 ${opt.border}`
                                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                                }`}
                              >
                                <OptIcon className={`h-4 w-4 ${isActive ? opt.iconColor : "text-muted-foreground"}`} />
                                <span className="flex-1 text-left">{t(opt.labelKey)}</span>
                                {isActive && <Check className="h-3.5 w-3.5 opacity-80" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${currentCatOption.border} ${currentCatOption.bg} ${currentCatOption.iconColor}`}
                    >
                      <CurrentCatIcon className="h-3.5 w-3.5" />
                      {t(currentCatOption.labelKey)}
                    </span>
                  )}
                </div>
              </div>

              {/* CHECKED IN BY 用户头像胶囊 — 全站统一 MemberAvatar（真实头像 → 专属色首字母圆） */}
              <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-input p-3 ring-1 ring-border">
                <div className="h-9 w-9 overflow-hidden rounded-full">
                  <MemberAvatar
                    member={creatorInfo}
                    fallbackId={checkin?.user_id}
                    fallbackName={creatorName}
                    textClassName="text-sm font-bold"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t("footprints.checkedInBy")}
                  </p>
                  <p className="text-sm font-semibold text-foreground">{creatorName}</p>
                </div>
              </div>

              {/* 地点 + 时间胶囊 + 地图定位按钮 */}
              <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-input px-3 py-1.5 ring-1 ring-border">
                    <MapPin className="h-3.5 w-3.5 text-brand" />
                    {formattedLocation}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-input px-3 py-1.5 ring-1 ring-border">
                    <Calendar className="h-3.5 w-3.5 text-brand" />
                    {formatDate(checkin.created_at, locale)}
                  </span>
                </div>
                {/* 黄色圆形地图定位按钮 — 百科同款 */}
                <button
                  type="button"
                  onClick={() => {
                    const target = checkin;
                    onOpenChange(false);
                    if (target && onLocate) onLocate(target);
                  }}
                  title={isEn ? "Locate on map" : "地图定位"}
                  aria-label={isEn ? "Locate on map" : "地图定位"}
                  className="ml-auto w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 active:scale-95 transition-all shadow-sm"
                >
                  <MapPin className="h-4 w-4" />
                </button>
              </div>

              {/* TRAVEL MEMORIES — 回忆/备注文本框 */}
              <div className="mt-6">
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <User className="h-3 w-3" />
                  {t("footprints.travelMemoriesByName", { name: creatorName })}
                </label>
                {isEditing ? (
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder={isEn ? "What do you remember about this place?" : "在这里记录你的回忆…"}
                    className="mt-2 w-full resize-none rounded-2xl border border-border bg-input/80 p-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                ) : (
                  <div className="mt-2 w-full resize-none rounded-2xl border border-border bg-input/80 p-4 text-sm text-foreground">
                    {fullCheckin?.note && fullCheckin.note.trim() ? (
                      <p className="whitespace-pre-wrap">{fullCheckin.note}</p>
                    ) : (
                      <p className="italic text-muted-foreground">
                        {isEn ? "No memories recorded yet." : "暂无回忆记录。"}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ─── 操作按钮区：浏览态 vs 编辑态 ─── */}
              <div className="mt-6 flex items-center justify-end gap-3">
                {!isEditing ? (
                  <>
                    {/* 浏览模式：编辑（仅创建者）+ 导航 + 分享 */}
                    {isCreator && (
                      <button
                        onClick={() => setIsEditing(true)}
                        title={isEn ? "Edit" : "编辑"}
                        aria-label={isEn ? "Edit" : "编辑"}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-brand transition-all hover:scale-105"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      onClick={() => setShowNavPicker(true)}
                      title={t("nav.navigate")}
                      aria-label={t("nav.navigate")}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-brand/40 bg-muted text-brand transition-all hover:scale-105"
                    >
                      <Navigation className="h-4 w-4" />
                    </button>

                    <button
                      onClick={() => share.mutate()}
                      disabled={share.isPending}
                      title={t("checkinDetail.shareToChat")}
                      aria-label={t("checkinDetail.shareToChat")}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] transition-all hover:scale-105 disabled:opacity-60"
                    >
                      {share.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Share2 className="h-4 w-4 text-brand-foreground" />
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    {/* 编辑模式：删除 + 保存（隐藏导航与分享） */}
                    {showConfirmDelete ? (
                      <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-1.5">
                        <button
                          onClick={handleCancelDelete}
                          disabled={isDeleting}
                          className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-foreground/10"
                        >
                          {isEn ? "Cancel" : "取消"}
                        </button>
                        <button
                          onClick={confirmDelete}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/30"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          {isEn ? "Confirm" : "确认删除"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleTrashClick}
                        title={isEn ? "Delete" : "删除"}
                        aria-label={isEn ? "Delete" : "删除"}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/40 bg-red-950/40 text-red-400 transition-all hover:scale-105"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      onClick={handleSave}
                      disabled={!hasChanges || saving}
                      title={isEn ? "Save" : "保存"}
                      aria-label={isEn ? "Save" : "保存"}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 text-brand-foreground" />
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>

      </Sheet>

      {/* 外部地图导航选择弹窗 — 通过 createPortal 渲染到 body，避免 Radix Sheet 拦截 pointer-events */}
      {showNavPicker && checkin && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowNavPicker(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl border bg-white/95 dark:bg-slate-900/95 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-xl pb-[env(safe-area-inset-bottom,0px)] animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold">
                {isEn ? "Choose Navigation App" : "选择导航应用"}
              </h3>
              <button
                onClick={() => setShowNavPicker(false)}
                className="rounded-full p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 拖拽指示条 */}
            <div className="mx-auto mt-1 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />

            {/* 地图应用列表 */}
            <div className="px-3 py-3 space-y-1">
              {([
                {
                  name: isEn ? "Amap (高德地图)" : "高德地图",
                  url: `https://uri.amap.com/marker?position=${checkin.lng},${checkin.lat}&name=${encodeURIComponent(checkin.title || "")}&src=mypage&coordinate=gaode&callnative=1`,
                  color: "text-blue-600 dark:text-blue-400",
                  bg: "bg-blue-50 dark:bg-blue-500/10",
                  Icon: Navigation,
                },
                {
                  name: isEn ? "Baidu Maps (百度地图)" : "百度地图",
                  url: `https://api.map.baidu.com/marker?location=${checkin.lat},${checkin.lng}&title=${encodeURIComponent(checkin.title || "")}&content=${encodeURIComponent(checkin.title || "")}&output=html&src=webapp.baidu.openAPIdemo`,
                  color: "text-red-600 dark:text-red-400",
                  bg: "bg-red-50 dark:bg-red-500/10",
                  Icon: Navigation,
                },
                {
                  name: "Google Maps",
                  url: `https://www.google.com/maps/search/?api=1&query=${checkin.lat},${checkin.lng}`,
                  color: "text-emerald-600 dark:text-emerald-400",
                  bg: "bg-emerald-50 dark:bg-emerald-500/10",
                  Icon: Navigation,
                },
                {
                  name: isEn ? "Apple Maps (苹果地图)" : "苹果地图",
                  url: `http://maps.apple.com/?daddr=${checkin.lat},${checkin.lng}&q=${encodeURIComponent(checkin.title || "")}`,
                  color: "text-slate-700 dark:text-slate-300",
                  bg: "bg-slate-100 dark:bg-slate-700/30",
                  Icon: Navigation,
                },
              ]).map((app) => {
                const AppIcon = app.Icon;
                return (
                  <button
                    key={app.name}
                    onClick={() => {
                      window.open(app.url, "_blank");
                      setShowNavPicker(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 transition hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.98]"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${app.bg} ${app.color}`}>
                      <AppIcon className="h-5 w-5" />
                    </span>
                    <span className="flex-1 text-left text-sm font-semibold">
                      {app.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {isEn ? "Open" : "打开"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 取消按钮 */}
            <div className="px-3 pb-4">
              <button
                onClick={() => setShowNavPicker(false)}
                className="w-full rounded-2xl py-3.5 text-sm font-semibold text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {isEn ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
