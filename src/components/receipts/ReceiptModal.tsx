import { useState, useEffect } from "react";
import { X, Save, Trash2, MapPin, Calendar, User, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { resolveCityKey, getLocalizedCity } from "@/constants/locations";
import type { Receipt, TeamMember } from "./types";
import { toast } from "sonner";
import { LocationInput } from "./SharedComponents";
import { CachedImage } from "@/components/signed-image";

interface Props {
  receipt: Receipt | null;
  teamMembers: TeamMember[];
  onClose: () => void;
  onSave: (updated: Receipt) => void;
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

const labelCls =
  "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

export function ReceiptModal({
  receipt,
  teamMembers,
  onClose,
  onSave,
  onDelete,
  tripId,
}: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  // 城市/详细地点：拆分为 city（展示名）+ cityKey（标准 ID）+ detailLocation（自由文本）
  const [city, setCity] = useState("");
  const [cityKey, setCityKey] = useState("");
  const [detailLocation, setDetailLocation] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [recorderId, setRecorderId] = useState("");
  const [note, setNote] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (receipt) {
      setTitle(receipt.title);
      setImageUrl(receipt.image_url);
      // 回显优先级：city_key + detail_address > location 字符串解析
      if (receipt.city_key) {
        setCityKey(receipt.city_key);
        // 用当前语言的本地化名回显，保证切换语言时地名也能跟随
        setCity(getLocalizedCity(receipt.city_key, isEn ? "en" : "zh"));
      } else {
        // 兼容旧数据：location 字符串以 " · " 分割为城市 + 详细地址
        const parts = (receipt.location || "").split(" · ");
        const parsedCity = parts[0] || "";
        setCity(parsedCity);
        setCityKey(resolveCityKey(parsedCity) || "");
      }
      setDetailLocation(
        receipt.detail_address !== undefined
          ? receipt.detail_address
          : (receipt.location || "").split(" · ").slice(1).join(" · ")
      );
      setDate(receipt.date);
      setAmount(String(receipt.amount));
      setCurrency(receipt.currency);
      setRecorderId(receipt.recorder);
      setNote(receipt.note);
      // 回显：只要 is_shared 或 is_starred 任一为 true，开关均显示为开启
      setIsShared(Boolean(receipt.is_shared) || Boolean(receipt.is_starred));
    } else {
      // 新增模式：清空表单，仅预填今日日期
      setTitle("");
      setImageUrl("");
      setCity("");
      setCityKey("");
      setDetailLocation("");
      const today = new Date().toISOString().split("T")[0];
      setDate(today);
      setAmount("");
      setCurrency("CNY");
      setRecorderId("");
      setNote("");
      setIsShared(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  const handleSave = async () => {
    if (!title.trim() || !recorderId) {
      toast.error(isEn ? "Please fill in required fields" : "请填写必填字段");
      return;
    }

    setSaving(true);
    try {
      const locationParts = [city.trim(), detailLocation.trim()].filter(Boolean);
      const fullLocation = locationParts.length > 0 ? locationParts.join(" · ") : "";

      const newReceipt: Receipt = {
        id: receipt?.id || crypto.randomUUID(),
        trip_id: tripId,
        // 关键：必须写入 user_id，否则 Supabase RLS 策略会拒绝插入，
        // 数据无法持久化到远端，重新进入页面时拉不到数据表现为空白
        user_id: recorderId,
        title: title.trim(),
        image_url: imageUrl.trim(),
        location: fullLocation,
        city_key: cityKey,
        detail_address: detailLocation.trim(),
        date: date,
        amount: parseFloat(amount) || 0,
        currency: currency,
        recorder: recorderId,
        recorder_name:
          teamMembers.find((m) => m.user_id === recorderId)?.display_name || "",
        recorder_avatar_url:
          teamMembers.find((m) => m.user_id === recorderId)?.avatar_url || null,
        note: note.trim(),
        is_shared: isShared,
        is_starred: isShared,
        created_at: receipt?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Dual persistence: Supabase first, then sync to localStorage
      // 仅发送 Supabase 表实际拥有的列，避免传入 id/created_at/trip_id 等不可写字段引发报错
      const dbPayload = {
        user_id: newReceipt.user_id,
        title: newReceipt.title,
        image_url: newReceipt.image_url,
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
        updated_at: newReceipt.updated_at,
      };

      try {
        let dbError: any = null;
        if (receipt) {
          // 编辑模式：update 不传 id/created_at，避免主键冲突；不 select 回传以节省流量
          const { error } = await (supabase as any)
            .from("receipts")
            .update(dbPayload)
            .eq("id", receipt.id);
          dbError = error;
        } else {
          // 新建模式：insert 时不 select 回传（data 未使用），节省含 base64 图片的回传流量
          const { error } = await (supabase as any)
            .from("receipts")
            .insert([{ id: newReceipt.id, ...dbPayload, created_at: newReceipt.created_at }]);
          dbError = error;
        }
        if (dbError) {
          console.error("[ReceiptModal] Supabase save failed:", dbError);
          toast.error(isEn ? "Save failed, please retry" : "保存失败，请重试");
          return;
        }
        console.log("[ReceiptModal] Supabase save ok for", newReceipt.id);
      } catch (dbErr) {
        console.error("[ReceiptModal] Supabase save threw:", dbErr);
        toast.error(isEn ? "Save failed, please retry" : "保存失败，请重试");
        return;
      }

      // Sync to localStorage (refresh-safe persistence)
      const localList = loadFromLocal(tripId);
      const idx = localList.findIndex((r) => r.id === newReceipt.id);
      if (idx >= 0) {
        localList[idx] = newReceipt;
      } else {
        localList.unshift(newReceipt);
      }
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

  const handleDelete = async () => {
    if (!receipt) return;
    setDeleting(true);
    try {
      // Dual persistence: Supabase delete + localStorage delete
      try {
        await (supabase as any).from("receipts").delete().eq("id", receipt.id);
      } catch (dbErr) {
        console.warn("Supabase delete failed, will still remove from localStorage:", dbErr);
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
    }
  };

  // 弹窗安全滚动 Lock Hook：组件挂载即锁定 body 滚动，卸载/关闭时必定解锁，
  // 防止断网或异常销毁后 body 依然被死锁导致页面无法触控滑动
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow || "unset";
    };
  }, []);

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
            {receipt
              ? isEn ? "Edit Receipt" : "编辑票据"
              : isEn ? "New Receipt" : "新增票据"}
          </h2>

          <div className="space-y-4">
            {/* RECEIPT IMAGE */}
            <div className="space-y-2">
              <label className={labelCls}>
                <ImagePlus className="h-3 w-3" />
                {isEn ? "RECEIPT IMAGE" : "票据图片"}
              </label>
              {imageUrl ? (
                <div className="relative h-32 w-full overflow-hidden rounded-xl border border-border">
                  <CachedImage
                    value={imageUrl}
                    alt={title}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImageUrl("")}
                    aria-label="Clear image"
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder={isEn ? "Image URL" : "图片 URL"}
                  className={inputCls}
                />
              )}
            </div>

            {/* TITLE */}
            <div className="space-y-1.5">
              <label className={labelCls}>
                {isEn ? "TITLE" : "票据标题"}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isEn ? "Receipt title..." : "票据标题..."}
                className={inputCls}
              />
            </div>

            {/* LOCATION & DATE */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>
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
              <div className="space-y-1.5">
                <label className={labelCls}>
                  <Calendar className="h-3 w-3 text-brand" />
                  {isEn ? "DATE" : "日期"}
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            {/* AMOUNT & CURRENCY */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelCls}>
                  {isEn ? "AMOUNT" : "金额"}
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelCls}>
                  {isEn ? "CURRENCY" : "币种"}
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={inputCls}
                >
                  <option value="CNY">CNY ¥</option>
                  <option value="USD">USD $</option>
                  <option value="EUR">EUR €</option>
                  <option value="GBP">GBP £</option>
                  <option value="JPY">JPY ¥</option>
                </select>
              </div>
            </div>

            {/* RECORDER — dynamic from team Profile members */}
            <div className="space-y-1.5">
              <label className={labelCls}>
                <User className="h-3 w-3" />
                {isEn ? "RECORDER" : "记录人"}
              </label>
              <select
                value={recorderId}
                onChange={(e) => setRecorderId(e.target.value)}
                className={inputCls}
              >
                <option value="">
                  {isEn ? "Select recorder" : "选择记录人"}
                </option>
                {teamMembers.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* NOTES */}
            <div className="space-y-1.5">
              <label className={labelCls}>
                {isEn ? "NOTES" : "备注"}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={
                  isEn
                    ? "Additional notes (e.g., William paid · 4 people)"
                    : "备注信息（如：William 垫付 · 4 人份）"
                }
                className={`${inputCls} resize-none`}
              />
            </div>

            {/* Team Shared Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {isEn ? "Team Shared" : "团队共享"}
              </span>
              <button
                type="button"
                onClick={() => setIsShared(!isShared)}
                aria-label="Toggle shared"
                className={`relative h-6 w-11 rounded-full transition-all ${
                  isShared ? "bg-brand" : "bg-muted"
                }`}
              >
                <div
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                    isShared ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Action buttons — pure Icon, save uses p-3.5 unified spec */}
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            {/* 删除按钮（仅编辑模式） */}
            {receipt && (
              <button
                type="button"
                onClick={() => handleDelete()}
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
            )}

            {/* 保存按钮：纯软盘 Icon + 青蓝发光胶囊 */}
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={saving || !title.trim()}
              aria-label={isEn ? "Save" : "保存"}
              className="flex items-center justify-center rounded-full bg-brand p-3.5 text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
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
