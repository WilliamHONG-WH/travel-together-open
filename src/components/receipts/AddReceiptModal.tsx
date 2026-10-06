import { useState, useRef, useEffect } from "react";
import { X, Save, MapPin, Calendar, User, ImagePlus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { reverseGeocode } from "@/lib/geocode";
import { resolveCityKey } from "@/constants/locations";
import { uploadImageToStorage } from "@/lib/compress-image";
import type { Receipt, TeamMember } from "./types";
import { toast } from "sonner";
import { CustomDropdown, LocationInput } from "./SharedComponents";
import { UnifiedCalendarGrid, type CalendarMode } from "@/components/unified-calendar";

interface Props {
  teamMembers: TeamMember[];
  currentUserId: string | null;
  defaultCity?: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (receipt: Receipt) => void;
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

export function AddReceiptModal({ teamMembers, currentUserId, defaultCity = "", isOpen, onClose, onSave, tripId }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [title, setTitle] = useState("");
  // 多图状态：newPhotos 为压缩后的 File + 本地预览 ObjectURL 列表（待上传至 Storage）
  // 不再使用 Base64 — 保存时统一上传至 Supabase Storage，数据库仅存路径数组
  const [newPhotos, setNewPhotos] = useState<{ file: File; url: string }[]>([]);
  const [city, setCity] = useState(defaultCity);
  // 标准 city_key（如 "milan"），由 LocationInput 联想选中后回填；空字符串表示未选城市
  const [cityKey, setCityKey] = useState("");
  const [detailLocation, setDetailLocation] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("last_used_currency") || "CNY";
    }
    return "CNY";
  });
  const [recorderId, setRecorderId] = useState(
    currentUserId || (teamMembers[0]?.user_id ?? "")
  );
  const [note, setNote] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("day");
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

  // 自动获取真实 GPS 定位城市：仅在新建票据弹窗打开时触发
  useEffect(() => {
    let cancelled = false;
    if (isOpen && !city) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            if (cancelled) return;
            const { latitude, longitude } = position.coords;
            const detectedCity = await reverseGeocode(latitude, longitude, locale);
            if (!cancelled && detectedCity && detectedCity !== "Unknown" && detectedCity !== "未知区域") {
              setCity(detectedCity);
              // 尝试从反查到的城市名解析标准 city_key，便于持久化与多语言联动
              const resolved = resolveCityKey(detectedCity);
              if (resolved) setCityKey(resolved);
            } else if (!cancelled && defaultCity) {
              setCity(defaultCity);
              const resolved = resolveCityKey(defaultCity);
              if (resolved) setCityKey(resolved);
            }
          },
          () => {
            if (cancelled) return;
            if (!city && defaultCity) {
              setCity(defaultCity);
              const resolved = resolveCityKey(defaultCity);
              if (resolved) setCityKey(resolved);
            }
          },
        );
      } else if (!city && defaultCity) {
        setCity(defaultCity);
        const resolved = resolveCityKey(defaultCity);
        if (resolved) setCityKey(resolved);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, city, defaultCity, locale]);

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
      // 允许连续选择同一批文件（清空 value 触发 change）
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 移除待上传缩略图（同时释放 ObjectURL 防止内存泄漏）
  const handleRemovePhoto = (index: number) => {
    setNewPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSave = async () => {
    if (!title.trim() || !recorderId) {
      toast.error(isEn ? "Please fill in required fields" : "请填写必填字段");
      return;
    }

    setSaving(true);
    try {
      const selectedMember = teamMembers.find((m) => m.user_id === recorderId);
      const locationParts = [city.trim(), detailLocation.trim()].filter(Boolean);
      const fullLocation = locationParts.length > 0 ? locationParts.join(" · ") : "";

      // 1. 多图上传：逐张上传至 Supabase Storage，数据库仅存路径数组（彻底废除 Base64）
      //    RLS 要求路径第二段 = auth.uid()，因此前缀为 `${tripId}/${recorderId}`
      const imagePaths: string[] = [];
      for (const photo of newPhotos) {
        const path = await uploadImageToStorage(photo.file, `${tripId}/${recorderId}`);
        imagePaths.push(path);
      }

      const newReceipt: Receipt = {
        id: crypto.randomUUID(),
        trip_id: tripId,
        title: title.trim(),
        // 首图冗余写入 image_url，旧版本客户端/旧数据逻辑向下兼容
        image_url: imagePaths[0] ?? "",
        images: imagePaths,
        location: fullLocation,
        city_key: cityKey,
        detail_address: detailLocation.trim(),
        date: dateTime || new Date().toISOString(),
        amount: parseFloat(amount) || 0,
        currency: currency,
        recorder: recorderId,
        recorder_name: selectedMember?.display_name || "",
        recorder_avatar_url: selectedMember?.avatar_url || null,
        // 关键：user_id 必须是当前登录用户（auth.uid()），而非所选记录人 —
        // 记录人可以是队友，但 RLS/归属判断以当前登录用户为准
        user_id: currentUserId || recorderId,
        note: note.trim(),
        is_shared: isShared,
        is_starred: isShared,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // DB payload：含 trip_id — RLS 行程成员策略依据 trip_id 校验，
      // 缺失 trip_id 时其他队员将被数据库拦截看不到该票据
      // 关键修复：必须检查 insert 的 error 返回值（supabase-js 不抛异常），
      // 否则 RLS 拦截/列缺失时会静默失败 → 手机端"假保存"、其他设备永远看不到
      const dbPayload = {
        id: newReceipt.id,
        trip_id: tripId,
        user_id: newReceipt.user_id,
        title: newReceipt.title,
        image_url: newReceipt.image_url,
        images: newReceipt.images,
        location: newReceipt.location,
        city_key: newReceipt.city_key,
        detail_address: newReceipt.detail_address,
        date: newReceipt.date,
        amount: newReceipt.amount,
        currency: newReceipt.currency,
        recorder: newReceipt.recorder,
        recorder_name: newReceipt.recorder_name,
        recorder_avatar_url: newReceipt.recorder_avatar_url,
        note: newReceipt.note,
        is_shared: newReceipt.is_shared,
        is_starred: newReceipt.is_starred,
        created_at: newReceipt.created_at,
        updated_at: newReceipt.updated_at,
      };
      const { error: insertError } = await (supabase as any)
        .from("receipts")
        .insert(dbPayload);
      if (insertError) {
        console.error("[AddReceiptModal] Supabase insert failed:", insertError);
        toast.error(
          insertError.message ||
            (isEn ? "Save failed, please retry" : "保存失败，请重试")
        );
        return;
      }

      const localList = loadFromLocal(tripId);
      localList.unshift(newReceipt);
      saveToLocal(tripId, localList);

      onSave(newReceipt);
      toast.success(isEn ? "Saved successfully" : "保存成功");
      onClose();
    } catch (err: any) {
      console.error("Save failed:", err);
      toast.error(err?.message ?? (isEn ? "Save failed" : "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] bg-card border border-border rounded-3xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-50 rounded-full bg-black/70 p-2 text-slate-100 shadow-lg ring-1 ring-border backdrop-blur transition hover:bg-black/90 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700 p-5 pb-28">
          <h2 className="mb-4 text-xl font-bold text-foreground">
            {isEn ? "New Receipt" : "新增票据"}
          </h2>

          <div className="space-y-4">
            {/* 多图选择区：缩略图网格 + 末尾【+ 添加图片】按钮，支持持续追加 */}
            <div className="space-y-2">
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <ImagePlus className="h-3 w-3" />
                {isEn ? "RECEIPT IMAGES" : "票据图片"}
              </label>
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
                {newPhotos.map((photo, index) => (
                  <div
                    key={photo.url}
                    className="relative aspect-square rounded-xl border border-border overflow-hidden group"
                  >
                    <img
                      src={photo.url}
                      alt={`Receipt preview ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(index)}
                      aria-label={isEn ? `Remove image ${index + 1}` : `删除图片 ${index + 1}`}
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

          {/* 底部操作栏：仅保留保存按钮（删除取消按钮） */}
          <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
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
          </div>
        </div>
      </div>
    </div>
  );
}
