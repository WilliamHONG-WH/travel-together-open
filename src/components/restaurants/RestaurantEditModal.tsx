import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2, ImagePlus, Save, Store, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Dish, MealType, Restaurant } from "./types";
import { MEAL_TYPES, uid } from "./types";
import { compressImageToFile } from "@/lib/compress-image";
import { CachedImage } from "@/components/signed-image";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  /** null = 新建；否则为编辑目标 */
  initial: Restaurant | null;
  onClose: () => void;
  /** 表单提交（含待上传新图）；由父层负责上传 + 落库 */
  onSave: (form: Restaurant, newFiles: File[]) => Promise<void>;
  /** 删除（仅编辑态显示） */
  onDelete: (r: Restaurant) => Promise<void>;
  locale: string;
  isEn: boolean;
}

const blank = (): Restaurant => ({
  id: uid(),
  trip_id: "",
  name: "",
  city: "",
  country: "",
  meal_type: "dinner",
  address: "",
  hours: "",
  notes: "",
  dishes: [],
  attachments: [],
  latitude: null,
  longitude: null,
  created_at: "",
});

export function RestaurantEditModal({ open, initial, onClose, onSave, onDelete, locale: _locale, isEn }: Props) {
  const [form, setForm] = useState<Restaurant>(blank);
  const [newPhotos, setNewPhotos] = useState<{ file: File; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ? { ...initial, dishes: [...initial.dishes], attachments: [...initial.attachments] } : blank());
      setNewPhotos([]);
      setConfirmDelete(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof Restaurant>(k: K, v: Restaurant[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function updateDish(id: string, patch: Partial<Dish>) {
    setForm((f) => ({
      ...f,
      dishes: f.dishes.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setCompressing(true);
    try {
      // 逐张压缩为 File 并用 ObjectURL 即时预览，保存时统一上传至 Storage（对齐票据模块）
      const compressedList = await Promise.all(
        Array.from(files).map(async (file) => {
          const compressed = await compressImageToFile(file);
          return { file: compressed, url: URL.createObjectURL(compressed) };
        }),
      );
      setNewPhotos((prev) => [...prev, ...compressedList]);
    } catch (err) {
      console.error("Image compress failed:", err);
      toast.error(isEn ? "Image processing failed" : "图片处理失败");
    } finally {
      setCompressing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeNewPhoto(index: number) {
    setNewPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSave() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(
        {
          ...form,
          name: form.name.trim(),
          city: form.city.trim(),
          country: form.country.trim(),
          address: form.address.trim(),
          hours: form.hours.trim(),
          notes: form.notes.trim(),
          dishes: form.dishes
            .map((d) => ({ ...d, name: d.name.trim(), price: d.price.trim(), note: d.note.trim() }))
            .filter((d) => d.name || d.price || d.note),
        },
        newPhotos.map((p) => p.file),
      );
      newPhotos.forEach((p) => URL.revokeObjectURL(p.url));
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? (isEn ? "Save failed" : "保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial || saving) return;
    setSaving(true);
    try {
      await onDelete(initial);
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? (isEn ? "Delete failed" : "删除失败"));
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "h-9 w-full rounded-xl border border-border/50 bg-card/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-[1200] flex animate-[fadeIn_0.15s_ease-out_forwards] items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-muted shadow-2xl animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 删除(编辑态) + 关闭 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Store className="h-4 w-4 text-brand" />
            <span>{initial ? (isEn ? "Edit Restaurant" : "编辑餐厅") : isEn ? "Add Restaurant" : "添加餐厅"}</span>
          </h3>
          <div className="flex items-center gap-2">
            {initial && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={isEn ? "Delete restaurant" : "删除餐厅"}
                title={isEn ? "Delete restaurant" : "删除餐厅"}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-red-500/30 bg-red-950/20 text-red-400 transition-all hover:bg-red-950/40 active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-full p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 表单滚动区 — 隐藏原生滚动条 */}
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <Field label={isEn ? "Restaurant Name" : "餐厅名称"}>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={isEn ? "Trattoria ZaZa" : "如：Trattoria ZaZa"}
              maxLength={255}
              autoFocus={!initial}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={isEn ? "City" : "城市"}>
              <input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder={isEn ? "Florence" : "佛罗伦萨"}
                maxLength={100}
                className={inputCls}
              />
            </Field>
            <Field label={isEn ? "Country" : "国家"}>
              <input
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
                placeholder={isEn ? "Italy" : "意大利"}
                maxLength={100}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label={isEn ? "Meal Type" : "餐段类型"}>
            <div className="flex flex-wrap gap-2">
              {MEAL_TYPES.map((m) => {
                const Icon = m.icon;
                const active = form.meal_type === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set("meal_type", m.id as MealType)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                      active
                        ? "bg-brand text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.3)]"
                        : "border border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {isEn ? m.en : m.zh}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label={isEn ? "Address" : "地址"}>
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder={isEn ? "Piazza del Mercato Centrale, 26/r" : "如：中央市场广场 26/r"}
              maxLength={500}
              className={inputCls}
            />
          </Field>

          <Field label={isEn ? "Opening Hours" : "营业时间"}>
            <input
              value={form.hours}
              onChange={(e) => set("hours", e.target.value)}
              placeholder={isEn ? "12:00 PM - 3:30 PM, 7:00 PM - 11:00 PM" : "如：12:00-15:30, 19:00-23:00"}
              maxLength={255}
              className={inputCls}
            />
          </Field>

          <Field label={isEn ? "Notes / Tips" : "备注 / Tips"}>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={isEn ? "Book ahead; queues on Sundays" : "如：建议提前预约，周日可能排队"}
              className={`${inputCls} h-auto resize-none py-2 leading-relaxed`}
            />
          </Field>

          {/* 必点菜品编辑器 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {isEn ? "Must-Order Dishes" : "必点菜品"}
              </p>
              {/* 菜品添加 — 纯 Icon 圆形按钮 */}
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    dishes: [...f.dishes, { id: uid(), name: "", price: "", note: "" }],
                  }))
                }
                aria-label={isEn ? "Add dish" : "添加菜品"}
                title={isEn ? "Add dish" : "添加菜品"}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-card border border-border text-muted-foreground transition-all hover:text-brand hover:border-brand/50 active:scale-95"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {form.dishes.map((d) => (
                <div key={d.id} className="rounded-xl border border-border bg-card/80 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => updateDish(d.id, { name: e.target.value })}
                      placeholder={isEn ? "Dish name" : "菜名 (中英文)"}
                      maxLength={255}
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      aria-label={isEn ? "Remove dish" : "删除菜品"}
                      title={isEn ? "Remove dish" : "删除菜品"}
                      onClick={() =>
                        setForm((f) => ({ ...f, dishes: f.dishes.filter((x) => x.id !== d.id) }))
                      }
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-red-950/30 hover:text-red-400 active:scale-95"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <input
                      value={d.price}
                      onChange={(e) => updateDish(d.id, { price: e.target.value })}
                      placeholder="€45"
                      maxLength={50}
                      className={inputCls}
                    />
                    <input
                      value={d.note}
                      onChange={(e) => updateDish(d.id, { note: e.target.value })}
                      placeholder={isEn ? "Signature dish" : "招牌必点 · 推荐 3-4 分熟"}
                      maxLength={500}
                      className={`${inputCls} col-span-2`}
                    />
                  </div>
                </div>
              ))}
              {form.dishes.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {isEn ? "No dishes yet — tap + to add one." : "暂无菜品，点击 + 添加。"}
                </p>
              )}
            </div>
          </div>

          {/* 攻略截图 */}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {isEn ? "Guide Screenshots" : "攻略截图"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {/* 已有附件（Storage 路径） */}
              {form.attachments.map((path) => (
                <div key={path} className="group relative overflow-hidden rounded-xl border border-border bg-card">
                  <CachedImage
                    value={path}
                    alt={isEn ? "Guide screenshot" : "攻略截图"}
                    className="h-24 w-full object-cover"
                  />
                  <button
                    type="button"
                    aria-label={isEn ? "Delete screenshot" : "删除截图"}
                    onClick={() =>
                      setForm((f) => ({ ...f, attachments: f.attachments.filter((x) => x !== path) }))
                    }
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1.5 text-white transition hover:bg-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {/* 新增待上传（ObjectURL 预览） */}
              {newPhotos.map((p, idx) => (
                <div key={p.url} className="group relative overflow-hidden rounded-xl border border-border bg-card">
                  <img src={p.url} alt={isEn ? "New screenshot" : "新截图"} className="h-24 w-full object-cover" />
                  <button
                    type="button"
                    aria-label={isEn ? "Delete screenshot" : "删除截图"}
                    onClick={() => removeNewPhoto(idx)}
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1.5 text-white transition hover:bg-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {/* 上传入口 */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={compressing}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-all hover:border-brand/50 hover:text-brand disabled:opacity-50"
              >
                {compressing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
                <span className="text-[10px]">{compressing ? (isEn ? "Processing" : "处理中") : isEn ? "Upload" : "上传"}</span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onFiles(e.target.files);
              }}
            />
          </div>
        </div>

        {/* 底部：居中圆形磁盘保存按钮（纯 Icon，无文字） */}
        <div className="flex shrink-0 justify-center border-t border-border p-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={!form.name.trim() || saving}
            aria-label={isEn ? "Save" : "保存"}
            title={isEn ? "Save" : "保存"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] transition-all hover:shadow-[0_0_16px_rgba(0,242,254,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          </button>
        </div>

        {/* 删除确认浮层（防误触） */}
        {confirmDelete && initial && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_forwards]">
            <div
              className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="text-sm font-bold text-foreground">
                {isEn ? "Delete Restaurant" : "删除餐厅"}
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {isEn
                  ? `Delete [${initial.name}] and all its data? This action is irreversible!`
                  : `确定要删除餐厅【${initial.name}】及其全部数据吗？此操作不可逆！`}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-foreground transition-all hover:bg-card"
                >
                  {isEn ? "Cancel" : "取消"}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-full bg-rose-600 px-4 py-1.5 font-semibold text-white shadow-lg shadow-rose-950/50 transition-all hover:bg-rose-500"
                >
                  {isEn ? "Delete" : "删除"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
