import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Save,
  Trash2,
  MapPin,
  Calendar,
  User,
  ImagePlus,
  Pencil,
  ReceiptText,
  Users,
  ZoomIn,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { resolveCityKey, getLocalizedCity } from "@/constants/locations";
import { formatLocalizedReceiptLocation } from "@/utils/location";
import { uploadImageToStorage } from "@/lib/compress-image";
import type { Receipt, TeamMember } from "./types";
import { toast } from "sonner";
import { CustomDropdown, LocationInput } from "./SharedComponents";
import { UnifiedCalendarGrid, type CalendarMode } from "@/components/unified-calendar";
import { getHighResImageUrl } from "@/lib/utils";
import { MemberAvatar } from "@/components/member-avatar";
import { CachedImage } from "@/components/signed-image";
import { usePrivateImage } from "@/lib/image-cache";
import { getReceiptImages } from "./image-utils";

interface Props {
  receipt: Receipt;
  teamMembers: TeamMember[];
  onClose: () => void;
  onSave: (receipt: Receipt) => void;
  onDelete: (id: string) => void;
  tripId: string;
}

const STORAGE_KEY = (tripId: string) => `receipts:${tripId}`;

function loadFromLocal(tripId: string): Receipt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Receipt[]) : [];
  } catch {
    return [];
  }
}

function saveToLocal(tripId: string, list: Receipt[]) {
  try {
    localStorage.setItem(STORAGE_KEY(tripId), JSON.stringify(list));
  } catch (err) {
    console.warn("localStorage save failed:", err);
  }
}

const inputCls =
  "w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/60 focus:outline-none transition-colors";

const currencyOptions = [
  { value: "CNY", label: "CNY ¥" },
  { value: "EUR", label: "EUR €" },
  { value: "USD", label: "USD $" },
  { value: "GBP", label: "GBP £" },
  { value: "JPY", label: "JPY ¥" },
  { value: "HKD", label: "HKD HK$" },
];

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
};

// 解析 location 字符串为 city · detail（仅用于兼容旧数据回显）
function parseLocation(loc: string): { city: string; detail: string } {
  if (!loc) return { city: "", detail: "" };
  const parts = loc.split(" · ");
  if (parts.length >= 2) {
    return { city: parts[0], detail: parts.slice(1).join(" · ") };
  }
  return { city: "", detail: loc };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  } catch {
    return dateStr;
  }
}

export function ReceiptDetailModal({ receipt, teamMembers, onClose, onSave, onDelete, tripId }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  // 浏览态 / 编辑态
  const [isEditing, setIsEditing] = useState(false);

  // 表单状态
  const [title, setTitle] = useState("");
  // 多图状态：existingImages 为数据库已有路径数组（回显），
  // newPhotos 为用户新选的压缩 File + ObjectURL（待上传）
  // 不再使用 Base64 — 新图保存时上传至 Storage，数据库仅存路径数组
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<{ file: File; url: string }[]>([]);
  const [city, setCity] = useState("");
  // 标准 city_key（如 "milan"），由 LocationInput 联想选中后回填；空字符串表示未选城市
  const [cityKey, setCityKey] = useState("");
  const [detailLocation, setDetailLocation] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [recorderId, setRecorderId] = useState("");
  const [note, setNote] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("day");
  // 全屏大图预览灯箱：开关 + 当前预览的图片下标
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  // 当前选中的日期字符串（yyyy-MM-dd）— 用于 UnifiedCalendarGrid 高亮
  const selectedDateStr = dateTime ? dateTime.substring(0, 10) : "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLDivElement>(null);

  const recorderOptions = teamMembers.map((m) => ({
    value: m.user_id,
    label: m.display_name,
  }));

  const handleCurrencyChange = (val: string) => {
    setCurrency(val);
    try {
      localStorage.setItem("last_used_currency", val);
    } catch {
      // ignore
    }
  };

  const handleBoxClick = () => {
    fileInputRef.current?.click();
  };

  const handleDateInputClick = () => {
    setShowCalendar(!showCalendar);
    if (dateTime) {
      try {
        setCalendarMonth(new Date(dateTime));
      } catch {
        setCalendarMonth(new Date());
      }
    }
  };

  const handleDateSelect = (date: Date) => {
    const dtStr = format(date, "yyyy-MM-dd'T'HH:mm");
    setDateTime(dtStr);
    setShowCalendar(false);
  };

  const formatDateDisplay = () => {
    if (!dateTime) return "";
    try {
      return format(new Date(dateTime), "MMM dd, yyyy");
    } catch {
      return dateTime;
    }
  };

  // 图片压缩中状态 — 压缩期间显示加载指示，避免用户以为卡顿
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsCompressingPhoto(true);
    try {
      // 逐张压缩为 File 并用 ObjectURL 即时预览，保存时统一上传至 Storage
      const { compressImageToFile } = await import("@/lib/compress-image");
      const compressedList = await Promise.all(
        files.map(async (file) => {
          const compressed = await compressImageToFile(file);
          return { file: compressed, url: URL.createObjectURL(compressed) };
        })
      );
      setNewPhotos((prev) => [...prev, ...compressedList]);
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(isEn ? "Image processing failed" : "图片处理失败");
    } finally {
      setIsCompressingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 移除已有图片（数据库路径，仅从待保存数组剔除）
  const handleRemoveExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  // 移除待上传缩略图（同时释放 ObjectURL 防止内存泄漏）
  const handleRemoveNewPhoto = (index: number) => {
    setNewPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  // 打开弹窗时初始化表单数据
  useEffect(() => {
    if (receipt) {
      setTitle(receipt.title);
      // 多图回显：images 数组优先，旧数据自动降级 [image_url]
      setExistingImages(getReceiptImages(receipt));
      setNewPhotos([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // 回显优先级：city_key + detail_address > location 字符串解析
      if (receipt.city_key) {
        setCityKey(receipt.city_key);
        // 用当前语言的本地化名回显，保证切换语言时地名也能跟随
        setCity(getLocalizedCity(receipt.city_key, isEn ? "en" : "zh"));
        setDetailLocation(receipt.detail_address || "");
      } else {
        // 兼容旧数据：location 字符串以 " · " 分割为城市 + 详细地址
        const { city: parsedCity, detail } = parseLocation(receipt.location);
        setCity(parsedCity);
        setCityKey(resolveCityKey(parsedCity) || "");
        setDetailLocation(detail);
      }

      if (receipt.date) {
        try {
          const dt = new Date(receipt.date);
          const dtStr = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setDateTime(dtStr);
        } catch {
          setDateTime("");
        }
      }
      setAmount(String(receipt.amount || ""));
      setCurrency(receipt.currency || "CNY");
      setRecorderId(receipt.recorder);
      setNote(receipt.note);
      // 回显：只要 is_shared 或 is_starred 任一为 true，开关均显示为开启
      setIsShared(Boolean(receipt.is_shared) || Boolean(receipt.is_starred));
      setIsEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  const handleSave = async () => {
    if (!title.trim() || !recorderId) {
      toast.error(isEn ? "Please fill in required fields" : "请填写必填字段");
      return;
    }
    // 安全校验：receipt.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!receipt.id) {
      toast.error(isEn ? "Receipt ID missing" : "票据 ID 缺失");
      return;
    }

    setSaving(true);
    try {
      const selectedMember = teamMembers.find((m) => m.user_id === recorderId);
      const locationParts = [city.trim(), detailLocation.trim()].filter(Boolean);
      const fullLocation = locationParts.length > 0 ? locationParts.join(" · ") : "";

      // 1. 多图上传：新选图片逐张上传至 Storage，与已有图片合并为最终路径数组
      //    RLS 要求路径第二段 = auth.uid()，因此前缀为 `${tripId}/${recorderId}`
      const uploadedPaths: string[] = [];
      for (const photo of newPhotos) {
        const path = await uploadImageToStorage(photo.file, `${tripId}/${recorderId}`);
        uploadedPaths.push(path);
      }
      const finalImages = [...existingImages, ...uploadedPaths];

      const updatedReceipt: Receipt = {
        ...receipt,
        title: title.trim(),
        // 首图冗余写入 image_url，旧版本客户端/旧数据逻辑向下兼容
        image_url: finalImages[0] ?? "",
        images: finalImages,
        location: fullLocation,
        city_key: cityKey,
        detail_address: detailLocation.trim(),
        date: dateTime || receipt.date,
        amount: parseFloat(amount) || 0,
        currency: currency,
        recorder: recorderId,
        recorder_name: selectedMember?.display_name || receipt.recorder_name,
        recorder_avatar_url: selectedMember?.avatar_url || receipt.recorder_avatar_url,
        user_id: receipt.user_id || recorderId,
        note: note.trim(),
        is_shared: isShared,
        is_starred: isShared,
        updated_at: new Date().toISOString(),
      };

      // DB payload：含 trip_id — RLS 行程成员策略依据 trip_id 校验；
      // 不含 id/created_at（update 不可写主键）
      // 关键修复：必须检查 update 的 error 返回值（supabase-js 不抛异常），
      // 否则 RLS 拦截/列缺失时会静默失败 → 本端"假保存"、其他设备永远看不到
      const dbPayload = {
        trip_id: receipt.trip_id || tripId,
        user_id: updatedReceipt.user_id,
        title: updatedReceipt.title,
        image_url: updatedReceipt.image_url,
        images: updatedReceipt.images,
        location: updatedReceipt.location,
        city_key: updatedReceipt.city_key,
        detail_address: updatedReceipt.detail_address,
        date: updatedReceipt.date,
        amount: updatedReceipt.amount,
        currency: updatedReceipt.currency,
        recorder: updatedReceipt.recorder,
        recorder_name: updatedReceipt.recorder_name,
        recorder_avatar_url: updatedReceipt.recorder_avatar_url,
        note: updatedReceipt.note,
        is_shared: updatedReceipt.is_shared,
        is_starred: updatedReceipt.is_starred,
        updated_at: updatedReceipt.updated_at,
      };
      const { error: updateError } = await (supabase as any)
        .from("receipts")
        .update(dbPayload)
        .eq("id", receipt.id);
      if (updateError) {
        console.error("[ReceiptDetailModal] Supabase update failed:", updateError);
        toast.error(
          updateError.message ||
            (isEn ? "Save failed, please retry" : "保存失败，请重试")
        );
        return;
      }

      const localList = loadFromLocal(tripId);
      const idx = localList.findIndex((r) => r.id === receipt.id);
      if (idx >= 0) {
        localList[idx] = updatedReceipt;
      } else {
        localList.unshift(updatedReceipt);
      }
      saveToLocal(tripId, localList);

      onSave(updatedReceipt);
      toast.success(isEn ? "Saved successfully" : "保存成功");
      onClose();
    } catch (err: any) {
      console.error("Save failed:", err);
      toast.error(err?.message ?? (isEn ? "Save failed" : "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    // 安全校验：receipt.id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!receipt.id) return;
    setDeleting(true);
    try {
      // 关键修复：检查 delete 的 error 返回值，失败时中止本地删除
      // （否则远端残留 → 其他设备"删不掉"的不同步现象）
      const { error: deleteError } = await (supabase as any)
        .from("receipts")
        .delete()
        .eq("id", receipt.id);
      if (deleteError) {
        console.error("[ReceiptDetailModal] Supabase delete failed:", deleteError);
        toast.error(
          deleteError.message ||
            (isEn ? "Delete failed, please retry" : "删除失败，请重试")
        );
        return;
      }

      const localList = loadFromLocal(tripId).filter((r) => r.id !== receipt.id);
      saveToLocal(tripId, localList);

      onDelete(receipt.id);
      toast.success(isEn ? "Deleted successfully" : "删除成功");
      onClose();
    } catch (err: any) {
      console.error("Delete failed:", err);
      toast.error(err?.message ?? (isEn ? "Delete failed" : "删除失败"));
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // 浏览态展示数据
  const symbol = CURRENCY_SYMBOL[receipt.currency || "CNY"] || "¥";
  const formattedPrice = `${symbol}${(receipt.amount || 0).toFixed(2)}`;
  // 记录人真实头像：必须绑定 receipt.recorder（记录人本人），不能优先用
  // receipt.user_id（那是上传者/归属人，代录场景下恒为当前登录用户）。
  // 渲染统一走 MemberAvatar：成员无自定义头像时渲染专属色首字母圆，
  // 与列表卡片 100% 一致，彻底废除 dicebear 卡通头像兜底
  const matchedMember =
    teamMembers.find((m) => m.user_id === receipt.recorder) ||
    teamMembers.find((m) => receipt.recorder && m.display_name === receipt.recorder) ||
    teamMembers.find((m) => receipt.recorder_name && m.display_name === receipt.recorder_name) ||
    teamMembers.find((m) => m.user_id === receipt.user_id);
  // 浏览态地点：优先 city_key + detail_address 多语言解析；降级用 location 字符串
  const displayLocation = formatLocalizedReceiptLocation(
    receipt.city_key || "",
    receipt.detail_address || "",
    locale,
  ) || receipt.location;

  // 浏览态多图列表：images 数组优先，旧数据自动降级 [image_url]
  const displayImages = getReceiptImages(receipt);

  // 弹窗安全滚动 Lock Hook：组件挂载即锁定 body 滚动，卸载/关闭时必定解锁，
  // 防止断网或异常销毁后 body 依然被死锁导致页面无法触控滑动
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-50 rounded-full bg-black/70 p-2 text-slate-100 shadow-lg ring-1 ring-border backdrop-blur transition hover:bg-black/90 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          {/* 滚动区域：封面图 + 顶栏 + 内容区统一滚动，确保移动端触控顺滑 */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700">
          {/* ========== 封面图片区域 ========== */}
          {isEditing ? (
            /* 编辑态：多图缩略网格 + 末尾【+ 添加图片】按钮 */
            <div className="w-full bg-muted/60 p-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                multiple
                className="hidden"
              />
              <div className="grid grid-cols-4 gap-2">
                {isCompressingPhoto && (
                  <div className="relative aspect-square rounded-xl border border-border bg-muted/60 overflow-hidden flex flex-col items-center justify-center gap-1">
                    <Loader2 className="w-5 h-5 text-brand animate-spin" />
                    <span className="text-[9px] text-brand font-medium">
                      {isEn ? "Processing" : "处理中"}
                    </span>
                  </div>
                )}
                {/* 已有图片（数据库路径） */}
                {existingImages.map((img, index) => (
                  <div
                    key={`existing-${img}`}
                    className="relative aspect-square rounded-xl border border-border overflow-hidden group"
                  >
                    <CachedImage
                      value={img}
                      alt={`${title} ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveExistingImage(index)}
                      aria-label={isEn ? `Remove image ${index + 1}` : `删除图片 ${index + 1}`}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white ring-1 ring-white/20 transition hover:bg-black/90"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {/* 新选图片（本地 ObjectURL 预览） */}
                {newPhotos.map((photo, index) => (
                  <div
                    key={`new-${photo.url}`}
                    className="relative aspect-square rounded-xl border border-brand/40 overflow-hidden"
                  >
                    <img
                      src={photo.url}
                      alt={`${isEn ? "New image" : "新图片"} ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveNewPhoto(index)}
                      aria-label={isEn ? `Remove new image ${index + 1}` : `删除新图片 ${index + 1}`}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white ring-1 ring-white/20 transition hover:bg-black/90"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {/* 末尾始终保留【+ 添加图片】按钮，支持持续追加新照片 */}
                <button
                  type="button"
                  onClick={handleBoxClick}
                  className="relative aspect-square rounded-xl border-2 border-dashed border-border hover:border-brand/80 bg-muted/40 hover:bg-muted/80 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-brand transition-all group"
                >
                  <ImagePlus className="w-5 h-5 group-hover:text-brand transition-colors" />
                  <span className="text-[9px] font-medium leading-tight text-center px-1">
                    {isEn ? "Add" : "添加图片"}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* 浏览态：按图片数量自适应拼图排版，点击任意图片唤起全屏 Lightbox */
            <div className="relative w-full bg-muted/60">
              {displayImages.length === 0 ? (
                <div className="flex w-full h-48 sm:h-56 items-center justify-center bg-gradient-to-br from-card to-muted">
                  <ReceiptText className="h-12 w-12 text-muted-foreground" />
                </div>
              ) : displayImages.length === 1 ? (
                /* 1 张图：单图铺满 */
                <div
                  className="relative w-full h-48 sm:h-56 overflow-hidden cursor-pointer group"
                  onClick={() => {
                    setPreviewIndex(0);
                    setIsPreviewOpen(true);
                  }}
                >
                  <CachedImage
                    value={displayImages[0]}
                    alt={receipt.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1 font-medium pointer-events-none">
                    <ZoomIn className="w-4 h-4" />
                    <span>{isEn ? "View full image" : "查看大图"}</span>
                  </div>
                </div>
              ) : displayImages.length === 2 ? (
                /* 2 张图：左右等分 */
                <div className="grid grid-cols-2 gap-2 h-48 sm:h-56 p-2">
                  {displayImages.map((img, i) => (
                    <div
                      key={img}
                      className="relative overflow-hidden rounded-xl cursor-pointer group"
                      onClick={() => {
                        setPreviewIndex(i);
                        setIsPreviewOpen(true);
                      }}
                    >
                      <CachedImage
                        value={img}
                        alt={`${receipt.title} ${i + 1}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  ))}
                </div>
              ) : displayImages.length === 3 ? (
                /* 3 张图：左边 1 张大图，右边 2 张小图垂直排列 */
                <div className="grid grid-cols-2 grid-rows-2 gap-2 h-48 sm:h-56 p-2">
                  <div
                    className="relative row-span-2 overflow-hidden rounded-xl cursor-pointer group"
                    onClick={() => {
                      setPreviewIndex(0);
                      setIsPreviewOpen(true);
                    }}
                  >
                    <CachedImage
                      value={displayImages[0]}
                      alt={`${receipt.title} 1`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  {displayImages.slice(1, 3).map((img, i) => (
                    <div
                      key={img}
                      className="relative overflow-hidden rounded-xl cursor-pointer group"
                      onClick={() => {
                        setPreviewIndex(i + 1);
                        setIsPreviewOpen(true);
                      }}
                    >
                      <CachedImage
                        value={img}
                        alt={`${receipt.title} ${i + 2}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                /* 4 张及以上：田字格网格（超出 4 张在最后一格显示 +N 角标） */
                <div className="grid grid-cols-2 gap-2 h-48 sm:h-56 p-2">
                  {displayImages.slice(0, 4).map((img, i) => {
                    const isLast = i === 3;
                    const extraCount = displayImages.length - 4;
                    return (
                      <div
                        key={img}
                        className="relative overflow-hidden rounded-xl cursor-pointer group"
                        onClick={() => {
                          setPreviewIndex(i);
                          setIsPreviewOpen(true);
                        }}
                      >
                        <CachedImage
                          value={img}
                          alt={`${receipt.title} ${i + 1}`}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        {isLast && extraCount > 0 && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="text-white text-xl font-bold">+{extraCount}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card via-card/40 to-transparent pointer-events-none" />
              {/* 右下角金额胶囊 — stopPropagation 避免点击触发预览 */}
              <div
                className="absolute bottom-3 right-3 rounded-full bg-card/90 border border-brand/50 px-3 py-1 text-sm font-bold text-brand shadow-[0_0_10px_rgba(0,242,254,0.3)]"
                onClick={(e) => e.stopPropagation()}
              >
                {formattedPrice}
              </div>
            </div>
          )}

          {/* ========== 顶部操作栏 ========== */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            {/* 左侧：金额胶囊（编辑态时隐藏，因为在图片上已有） */}
            {!isEditing && (
              <span className="text-sm font-bold text-brand">
                {formattedPrice}
              </span>
            )}
            {isEditing && (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isEn ? "Edit Mode" : "编辑模式"}
              </span>
            )}

            {/* 右侧：编辑/保存按钮 */}
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  {/* 删除按钮 */}
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    aria-label={isEn ? "Delete" : "删除"}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {deleting ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                    ) : (
                      <Trash2 className="h-5 w-5 text-red-400" />
                    )}
                  </button>
                  {/* 保存按钮 */}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !title.trim()}
                    aria-label={isEn ? "Save" : "保存"}
                    className="flex items-center justify-center rounded-full bg-brand p-3 text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed min-w-[48px]"
                  >
                    {saving ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-foreground border-t-transparent" />
                    ) : (
                      <Save className="w-5 h-5 text-brand-foreground" />
                    )}
                  </button>
                </>
              ) : (
                /* 铅笔编辑按钮 — 与百科模块完全一致 */
                <button
                  onClick={() => setIsEditing(true)}
                  aria-label={isEn ? "Edit" : "编辑"}
                  className="flex items-center justify-center rounded-full bg-brand/10 border border-brand/50 p-2.5 text-brand transition-all hover:bg-brand/20 shadow-[0_0_10px_rgba(0,242,254,0.3)]"
                >
                  <Pencil className="w-4 h-4 text-brand" />
                </button>
              )}
            </div>
          </div>

          {/* ========== 内容区域 ========== */}
          {/* pb-28 为底部预留 112px，确保「同步至团队票据库」开关能完全拉出，
              不被浮动的底部 TabBar 遮挡，可轻松按压 */}
          <div className="p-5 pb-28">
            {isEditing ? (
              /* ----- 编辑态：表单 ----- */
              <div className="space-y-4">
                {/* 标题 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {isEn ? "TITLE" : "标题"}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={isEn ? "e.g., Trattoria Milanese dinner" : "如：Trattoria Milanese 晚餐"}
                    className={inputCls}
                  />
                </div>

                {/* 金额 & 货币 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isEn ? "CURRENCY" : "币种"}
                    </label>
                    <CustomDropdown
                      value={currency}
                      options={currencyOptions}
                      onChange={handleCurrencyChange}
                      isEn={isEn}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {isEn ? "AMOUNT" : "金额"}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className={`${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                    />
                  </div>
                </div>

                {/* 地点 & 时间 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {isEn ? "LOCATION" : "地点"}
                    </label>
                    <LocationInput
                      city={city}
                      cityKey={cityKey}
                      detail={detailLocation}
                      onCityChange={setCity}
                      onCityKeyChange={setCityKey}
                      onDetailChange={setDetailLocation}
                      isEn={isEn}
                      locale={locale}
                    />
                  </div>
                  <div className="space-y-1.5 relative" ref={dateInputRef}>
                    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Calendar className="h-3 w-3 text-brand" />
                      {isEn ? "TIME" : "时间"}
                    </label>
                    <div
                      onClick={handleDateInputClick}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        showCalendar
                          ? "border-brand/60 bg-input text-foreground"
                          : "border-border bg-input text-muted-foreground"
                      }`}
                    >
                      <Calendar className="w-4 h-4 text-brand shrink-0" />
                      <span className={dateTime ? "text-foreground" : "text-muted-foreground"}>
                        {formatDateDisplay() || (isEn ? "Select date" : "选择日期")}
                      </span>
                    </div>
                    {showCalendar && (
                      <UnifiedCalendarGrid
                        mode={calendarMode}
                        viewDate={calendarMonth}
                        selectedDateStr={selectedDateStr}
                        setMode={setCalendarMode}
                        setViewDate={setCalendarMonth}
                        onSelectDate={(dateStr) => {
                          // 保持原有 dateTime 格式：yyyy-MM-dd'T'HH:mm（默认 00:00）
                          handleDateSelect(new Date(dateStr + "T00:00:00"));
                        }}
                        labelText={isEn ? "SELECT DATE" : "选择日期"}
                        isEn={isEn}
                        zIndexClass="z-[60]"
                        mobileOverlay
                        onClose={() => setShowCalendar(false)}
                      />
                    )}
                  </div>
                </div>

                {/* 记录者 */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <User className="h-3 w-3" />
                    {isEn ? "RECORDER" : "记录者"}
                  </label>
                  <CustomDropdown
                    value={recorderId}
                    options={recorderOptions}
                    onChange={setRecorderId}
                    isEn={isEn}
                  />
                </div>

                {/* 备注 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {isEn ? "REMARKS" : "备注"}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder={isEn ? "e.g., William paid · 4 people" : "如：William 垫付 · 4 人份"}
                    className={`${inputCls} resize-none`}
                  />
                </div>

                {/* 同步至团队票据夹 */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-input px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {isEn ? "Sync to Team Receipts" : "同步至团队票据夹"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsShared(!isShared)}
                    aria-label="Toggle shared"
                    className={`relative h-6 w-11 rounded-full transition-all ${
                      isShared ? "bg-brand" : "bg-muted"
                    }`}
                  >
                    <div className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${isShared ? "left-6" : "left-1"}`} />
                  </button>
                </div>
              </div>
            ) : (
              /* ----- 浏览态：纯展示 ----- */
              <div className="space-y-4">
                {/* 标题 */}
                <h2 className="text-xl font-bold text-foreground">
                  {receipt.title}
                </h2>

                {/* 地点 */}
                {displayLocation && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-brand shrink-0" />
                    <span className="text-foreground text-sm">{displayLocation}</span>
                  </div>
                )}

                {/* 日期 */}
                {receipt.date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-brand shrink-0" />
                    <span className="text-foreground text-sm">{formatDate(receipt.date)}</span>
                  </div>
                )}

                {/* 记录者 — 与列表卡片完全一致的统一头像 */}
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 overflow-hidden rounded-full border border-border bg-card">
                    <MemberAvatar
                      member={matchedMember}
                      fallbackId={receipt.recorder}
                      fallbackName={receipt.recorder_name}
                      fallbackAvatar={receipt.recorder_avatar_url}
                      textClassName="text-xs font-bold"
                    />
                  </div>
                  <span className="text-foreground text-sm font-medium">
                    {receipt.recorder_name || "William"}
                  </span>
                </div>

                {/* 备注 */}
                {receipt.note && (
                  <div className="rounded-2xl p-3 text-xs text-foreground bg-card border border-border/80">
                    {receipt.note}
                  </div>
                )}

                {/* 团队同步状态 */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  <span>
                    {isShared
                      ? (isEn ? "Synced to Team Receipts" : "已同步至团队票据夹")
                      : (isEn ? "Personal Receipt" : "个人票据")}
                  </span>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* 全屏大图预览灯箱：多图左右切换 + 双指缩放 + 双击放大，点击任意区域退出 */}
      {isPreviewOpen && displayImages.length > 0 && (
        <ReceiptLightbox
          images={displayImages}
          startIndex={previewIndex}
          isEn={isEn}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-card p-6 shadow-[0_0_40px_rgba(239,68,68,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {isEn ? "Confirm Delete" : "确认删除"}
            </h3>
            <p className="mb-6 text-sm text-muted-foreground">
              {isEn
                ? "Are you sure you want to delete this receipt? This action cannot be undone."
                : "确定要删除这张票据吗？此操作无法撤销。"}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-full border border-border bg-input px-4 py-2 text-sm text-muted-foreground transition-all hover:border-border hover:text-foreground"
              >
                {isEn ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-full border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-50"
              >
                {isEn ? "Delete" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 全屏大图预览灯箱（多图版）
// ─────────────────────────────────────────────────────────────────────────
// 对齐手机原生相册体验：
// - 多图左右切换（箭头按钮 / 键盘方向键 / 移动端单指左右滑动）
// - 双指缩放（Pinch-to-Zoom，1x ~ 5x）
// - 桌面端双击放大/还原
// - 点击任意空白区域退出（放大状态下点击不退出，防误触）
// - 高清通道加载（getHighResImageUrl 不限宽度，票据小字清晰可读）

function getTouchDistance(touches: React.TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function ReceiptLightbox({
  images,
  startIndex,
  isEn,
  onClose,
}: {
  images: string[];
  startIndex: number;
  isEn: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(startIndex, images.length - 1));
  const [scale, setScale] = useState(1);
  // 双指缩放基准：捏合开始时的两指距离与当时的缩放倍数
  const pinchBaseRef = useRef<{ startDist: number; startScale: number } | null>(null);
  // 单指滑动基准：滑动开始时的 X 坐标（用于左右切换图片）
  const swipeBaseRef = useRef<number | null>(null);
  // 双击检测：记录上次点击时间戳
  const lastTapRef = useRef(0);

  const goTo = useCallback(
    (next: number) => {
      const total = images.length;
      if (total === 0) return;
      setIndex(((next % total) + total) % total);
      setScale(1);
    },
    [images.length]
  );

  // 键盘交互：Esc 退出 / 左右方向键切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goTo(index - 1);
      if (e.key === "ArrowRight") goTo(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchBaseRef.current = {
        startDist: getTouchDistance(e.touches),
        startScale: scale,
      };
      swipeBaseRef.current = null;
    } else if (e.touches.length === 1) {
      swipeBaseRef.current = e.touches[0].clientX;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchBaseRef.current) {
      // 双指捏合：按距离比例实时缩放（1x ~ 5x）
      const dist = getTouchDistance(e.touches);
      const next = pinchBaseRef.current.startScale * (dist / pinchBaseRef.current.startDist);
      setScale(Math.min(5, Math.max(1, next)));
    }
  };

  const handleTouchEnd = () => {
    pinchBaseRef.current = null;
    swipeBaseRef.current = null;
  };

  // 单指滑动结束：横向位移超过 50px 判定为切换图片
  const handleSwipeMove = (clientX: number) => {
    if (swipeBaseRef.current === null || scale > 1) return;
    const dx = clientX - swipeBaseRef.current;
    if (Math.abs(dx) > 50) {
      goTo(dx < 0 ? index + 1 : index - 1);
      swipeBaseRef.current = null;
    }
  };

  const handleBackdropTap = () => {
    const now = Date.now();
    // 双击（间隔 < 300ms）：放大/还原
    if (now - lastTapRef.current < 300) {
      setScale((s) => (s > 1 ? 1 : 2.5));
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    // 放大状态下点击不退出（防误触），原始比例下点击退出
    if (scale === 1) onClose();
  };

  // 私密图走本地 IndexedDB 缓存链路解析（内存池命中则同步返回）
  const rawImage = images[index] ?? "";
  const resolvedUrl = usePrivateImage(rawImage, "checkin-images");
  const currentUrl = resolvedUrl ?? "";

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-md p-2 cursor-pointer animate-in fade-in duration-200 touch-none select-none"
      onClick={handleBackdropTap}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseUp={(e) => handleSwipeMove(e.clientX)}
    >
      {/* 高清大图：transform 缩放由 scale 驱动，双指捏合/双击实时响应 */}
      <img
        src={currentUrl ? getHighResImageUrl(currentUrl) : ""}
        alt={isEn ? `Receipt preview ${index + 1}` : `票据大图 ${index + 1}`}
        draggable={false}
        className="max-w-full max-h-full object-contain rounded-lg transition-transform duration-150 ease-out"
        style={{ transform: `scale(${scale})` }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* 多图切换：左箭头 */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label={isEn ? "Previous image" : "上一张"}
            onClick={(e) => {
              e.stopPropagation();
              goTo(index - 1);
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80 active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* 多图切换：右箭头 */}
          <button
            type="button"
            aria-label={isEn ? "Next image" : "下一张"}
            onClick={(e) => {
              e.stopPropagation();
              goTo(index + 1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80 active:scale-95"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {/* 页码指示器 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/80 text-xs bg-black/60 px-3 py-1.5 rounded-full ring-1 ring-white/15 pointer-events-none">
            {index + 1} / {images.length}
          </div>
        </>
      )}

      {/* 右上角轻量提示文案，替代传统顶栏关闭键，避免冲出屏幕顶端点击不到 */}
      <div className="absolute top-5 right-5 text-white/70 text-xs bg-card/80 px-3 py-1.5 rounded-full border border-border pointer-events-none">
        {isEn ? "Tap to exit · Pinch to zoom" : "点击退出 · 双指缩放"}
      </div>
    </div>
  );
}
