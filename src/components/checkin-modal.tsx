import { useState, useCallback, useEffect } from "react";
import { X, Camera, MapPin, Clock, Loader2, Landmark, Leaf, Soup, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n, useT } from "@/i18n";
import { USER_STAMPS_KEY } from "@/lib/user-stamps";
import { compressImageToFile } from "@/lib/compress-image";
import { CachedImage } from "@/components/signed-image";
import { reverseGeocodeFull } from "@/lib/geocode";
import { getLocalizedLocationName } from "@/utils/location";

// 分类 → Lucide 图标映射（与 PostageStamp / StampCard 标准组件统一）
const CATEGORY_ICON: Record<string, LucideIcon> = {
  cities: Landmark,
  nature: Leaf,
  food: Soup,
};

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

interface CheckInModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (data: { title: string; city: string; country: string; photo_url: string | null; notes: string; category: string }) => void;
  tripId: string;
  lat: number;
  lng: number;
}

export function CheckInModal({
  open,
  onClose,
  onSuccess,
  tripId,
  lat,
  lng,
}: CheckInModalProps) {
  const { locale } = useI18n();
  const t = useT();
  const isEn = locale === "en";
  const queryClient = useQueryClient();

  // 图片选择状态：photoFile 为压缩后的 File 对象（待上传），photoPreview 为本地预览 URL
  // 不再使用 Base64 — 图片压缩后直接上传至 Supabase Storage，数据库仅存路径
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [locationData, setLocationData] = useState<{ full: string; city: string; country: string; display: string }>({
    full: "",
    city: "",
    country: "",
    display: "",
  });
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("cities");
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState("You");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (open && lat && lng) {
      // 传入当前 locale，根据 App 语言强制带上 accept-language=zh-CN/en，
      // 从 Nominatim 源头获取对应语言的标准地名，避免中英文混杂存储
      reverseGeocodeFull(lat, lng, locale).then((loc) => {
        setLocationData(loc);
        setTitle("");
      });
    }
  }, [open, lat, lng, locale]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setUserName(data.display_name || user.email?.split("@")[0] || "You");
            setUserAvatar(data.avatar_url);
          }
        });
    });
  }, []);

  // 图片选择：先前端压缩为 File (≤300KB, maxDim 1600)，再用 ObjectURL 即时预览
  // 压缩后的 File 在 handleSubmit 时上传至 Supabase Storage，数据库仅存路径
  const handlePhotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const compressed = await compressImageToFile(file);
      setPhotoFile(compressed);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error("Image compress failed:", err);
      // 区分 OOM 降级场景：IMAGE_TOO_LARGE 提示用户截屏后重试，其他错误提示通用失败
      const msg = err instanceof Error && err.message === "IMAGE_TOO_LARGE"
        ? t("checkin.imageTooLarge")
        : t("checkin.imageFailed");
      alert(msg);
    } finally {
      setCompressing(false);
    }
  }, [photoPreview, t]);

  const handleSubmit = async () => {
    if (!tripId) return;
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const stampTitle = title || locationData.display || "Untitled";
      const stampCity = locationData.city || locationData.display || "";
      const stampCountry = locationData.country || "";
      const stampNotes = notes || "";
      const stampCategory = category || "cities";

      // 1. 如有图片：先压缩为 File (已在上传时完成) → 上传至 Supabase Storage
      //    数据库仅存 Storage 相对路径（极短字符串），彻底废除 Base64
      let photoPath: string | null = null;
      if (photoFile) {
        const filePath = `${tripId}/${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("checkin-images")
          .upload(filePath, photoFile, {
            contentType: "image/jpeg",
            cacheControl: "3600000",
            upsert: false,
          });
        if (uploadError) throw uploadError;
        photoPath = filePath;
      }

      // 2. 写入 user_stamps 表（主数据源）— photo_url 存 Storage 路径
      const { data: stampData, error: stampError } = await (supabase as any)
        .from("user_stamps")
        .insert({
          trip_id: tripId,
          created_by: user.id,
          title: stampTitle,
          city: stampCity,
          country: stampCountry,
          photo_url: photoPath,
          notes: stampNotes,
          category: stampCategory,
          latitude: lat,
          longitude: lng,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (stampError) throw stampError;
      const newStampId: string = stampData?.id ?? "";

      // 3. 同步写入 checkins 表（兼容旧版）— image_url 存同一 Storage 路径
      const { error: checkinError } = await (supabase as any)
        .from("checkins")
        .insert({
          id: newStampId || undefined,
          trip_id: tripId,
          user_id: user.id,
          title: stampTitle,
          note: stampNotes,
          category: stampCategory,
          image_url: photoPath,
          lat,
          lng,
          city: stampCity,
          country: stampCountry,
        });

      if (checkinError) {
        console.warn("checkins insert (legacy) failed (non-critical):", checkinError.message);
      }

      onSuccess?.({ title: stampTitle, city: stampCity, country: locationData.country || "", photo_url: photoPath, notes: stampNotes, category: stampCategory });

      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });

      onClose();
      // 清理本地图片状态
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFile(null);
      setPhotoPreview(null);
      setTitle("");
      setNotes("");
      setCategory("cities");
    } catch (err) {
      console.error("Check-in failed:", err);
      alert(isEn ? "Check-in failed. Please try again." : "打卡失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const now = new Date();
  // 强制英文日期格式（忽略系统语言环境），示例：AUG 08, 2026
  const dateStr = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(now);
  const timeStr = now.toLocaleTimeString(isEn ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: isEn });
  const dateTimeStr = `${dateStr}, ${timeStr}`;
  // 邮票右上角印章内的类别图标
  const StampCatIcon = CATEGORY_ICON[category] || Landmark;
  // 邮票主标题：与足迹模块 PostageStamp 完全对齐 ——
  // 通过 getLocalizedLocationName(city, "en") 将中文/拼音城市名转为英文城市名后 .toUpperCase()，
  // 确保即使 App 处于中文模式，邮票标题也强制渲染为纯英文大写（如 LOS ANGELES）。
  // city 为空时回退取 display 首个逗号前的城市段，避免把 "城市, 国家" 整串当标题。
  const stampCitySource =
    locationData.city || locationData.display.split(",")[0].trim() || "";
  const stampTitleText =
    getLocalizedLocationName(stampCitySource, "en").toUpperCase() || "UNTITLED";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      {/* 弹窗主体：底部弹层 + 顶部 mt-14 留白，确保不遮挡地图顶部返回按键与打卡数浮窗 */}
      <div className="relative w-full max-w-lg max-h-[85vh] mx-auto bg-card border-t border-border rounded-t-[32px] flex flex-col overflow-hidden shadow-2xl mt-14 animate-in fade-in slide-in-from-bottom-4 duration-200" onClick={(e) => e.stopPropagation()}>
        {/* 右上角固定关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2 rounded-full bg-card/80 hover:bg-muted text-muted-foreground transition-all active:scale-95"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 可滚动主体：使用 pb-28 预留底部缓冲，确保提交按钮不被 TabBar 遮挡 */}
        <div className="flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-slate-700">
        {/* Stamp Card Area - clickable for photo upload */}
        <div className="flex flex-col items-center px-6 pt-10 pb-4">
          <label className="relative w-full max-w-[280px] cursor-pointer" style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.55))" }}>
            <div className="relative aspect-[4/5] w-full p-0 bg-transparent dark:p-2.5 dark:bg-white transition-transform hover:scale-[1.02]" style={perforationMask}>
              <div className="relative h-full w-full overflow-hidden bg-muted">
                {photoPreview ? (
                  <img src={photoPreview} alt="Check-in" className="h-full w-full object-cover" />
                ) : compressing ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-brand" />
                    <span className="text-[10px] uppercase tracking-wider">{isEn ? "Compressing..." : "压缩中..."}</span>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-border">
                      <Camera className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] uppercase tracking-wider">{isEn ? "Tap to Add Photo" : "点击添加照片"}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/40" />
                {/* 右上角：圆形印章边框 + 类别 Icon（已删除 PASSPORT 标签和 STAMPED 文字，
                    与 PostageStamp 标准组件统一） */}
                <div className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-white/70 bg-black/20 backdrop-blur-sm">
                  <StampCatIcon className="h-4 w-4 text-white/90" strokeWidth={2} />
                </div>
                <div className="absolute inset-x-3 bottom-3 text-white">
                  <p className="font-serif text-lg font-bold leading-tight tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                    {/* 邮票底部主标题：强制英文大写城市名（与足迹模块 PostageStamp 对齐）。
                        不显示用户输入的 title（自定义标题如 "TEST STAMP"），
                        确保全 App 邮票下方第一行永远显示大写英文城市名（如 LOS ANGELES / JINJIANG） */}
                    {stampTitleText}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {dateStr.toUpperCase()}
                  </p>
                </div>
              </div>
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </label>
        </div>

        {/* Form */}
        <div className="space-y-5 border-t border-border px-6 pt-5 pb-28">
          {/* Checked in by + chips */}
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                {userAvatar ? <CachedImage value={userAvatar} bucket="avatars" alt="" className="h-full w-full rounded-full object-cover" /> : userName.charAt(0)}
              </div>
              <div>
                <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{t("footprints.checkedInBy")}</p>
                <p className="text-sm font-semibold text-foreground">{userName}</p>
              </div>
            </div>
            {/* Tags row: location + date */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-input px-3 py-1.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                <MapPin className="h-3 w-3 text-brand" />{locationData.display}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-input px-3 py-1.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                <Clock className="h-3 w-3 text-brand" />{dateTimeStr}
              </span>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{isEn ? "Title" : "标题"}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              placeholder={isEn ? "Give this place a name..." : "给这个地方起个名字..."} />
          </div>

          {/* Category */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{isEn ? "Category" : "分类"}</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[
                { key: "cities", label: "CITY", labelCn: "城市" },
                { key: "nature", label: "NATURE", labelCn: "自然" },
                { key: "food", label: "FOOD", labelCn: "美食" },
              ].map((c) => (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  className={`rounded-full px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all ${
                    category === c.key
                      ? "bg-brand/20 text-brand ring-1 ring-brand/50"
                      : "bg-input text-muted-foreground ring-1 ring-border hover:text-foreground"
                  }`}>
                  {isEn ? c.label : c.labelCn}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("footprints.travelMemories")}
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder={isEn ? "What do you feel about this place?" : "你对这个地方有什么感受？"}
              className="mt-1.5 w-full resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20" />
          </div>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={loading || compressing}
            className="flex w-full items-center justify-center rounded-full bg-brand py-3 text-sm font-semibold text-brand-foreground transition-all hover:shadow-[0_0_20px_rgba(0,191,165,0.5)] disabled:opacity-50">
            {loading || compressing ? <Loader2 className="h-4 w-4 animate-spin" /> : isEn ? "Check In" : "打卡"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
