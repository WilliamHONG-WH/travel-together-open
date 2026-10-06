import { useState } from "react";
import {
  X,
  MapPin,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Paperclip,
  Pencil,
  Lightbulb,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Restaurant } from "./types";
import { mealMeta } from "./types";
import { copyText } from "@/lib/copy-to-clipboard";
import { CachedImage } from "@/components/signed-image";
import { getLocalizedLocationName } from "@/utils/location";
import { getDeepLinksBySearch, type MapAppLink } from "@/lib/navigation";
import { geocodeVenue } from "@/lib/geocode";
import { useT } from "@/i18n";
import { useNavigate } from "@tanstack/react-router";

interface Props {
  restaurant: Restaurant | null;
  onClose: () => void;
  onEdit: (r: Restaurant) => void;
  locale: string;
  isEn: boolean;
  /** 当前行程 ID — 规划模块「地图定位」跳转 ?restaurant=<id> 深链用 */
  tripId?: string;
  /** 地图模块内弹窗的「一键定位」接管：就地飞行聚焦（规划模块走 ?restaurant= 深链跳转）；
   *  弹窗侧实时反算出坐标后通过 coords 传入，避免父层旧数据无坐标 */
  onLocateOnMap?: (coords?: { lat: number; lng: number }) => void;
}

export function RestaurantDetailModal({ restaurant, onClose, onEdit, locale, isEn, tripId, onLocateOnMap }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [mapSheetOpen, setMapSheetOpen] = useState(false);
  // 实时反算坐标的加载态（定位按钮转圈防重复点击）
  const [locating, setLocating] = useState(false);

  if (!restaurant) return null;
  const meal = mealMeta(restaurant.meal_type);
  const MealIcon = meal.icon;

  // 多地图导航查询串：名称 + 地址 + 城市（与地图模块导航弹窗共用链接生成）
  const mapQuery = `${restaurant.name} ${restaurant.address || ""} ${restaurant.city || ""}`.trim();
  const deepLinks: MapAppLink[] = getDeepLinksBySearch(mapQuery);

  // 攻略截图存于私密桶 checkin-images（Storage 相对路径），
  // 渲染走 CachedImage → 本地 IndexedDB 缓存链路（绝不经过第三方 CDN）
  const attachmentCount = restaurant.attachments.length;

  const cols =
    attachmentCount === 1
      ? "grid-cols-1"
      : attachmentCount === 2
        ? "grid-cols-2"
        : "grid-cols-2 sm:grid-cols-3";

  const handleCopyName = async () => {
    const ok = await copyText(restaurant.name);
    if (ok) {
      setCopied(true);
      toast.success(isEn ? `Copied: ${restaurant.name}` : `已复制餐厅名称：${restaurant.name}`);
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error(isEn ? "Copy failed" : "复制失败");
    }
  };

  /**
   * 「一键跳转地图定位」（对齐酒店/百科模块链路）：
   * - 已有坐标：直接关闭弹窗并飞向地图；
   * - 坐标为 null：立即按【地址 + 城市 + 国家 + 名称】实时正向地理编码反算，
   *   成功后异步写回 Supabase trip_restaurants 表持久化，随后立刻飞向地图 ——
   *   绝不直接报错放弃；仅当地址完全无法解析时才提示失败。
   * - 地图模块内弹窗：onLocateOnMap 接管（反算出的 coords 一并传入）；
   * - 规划-美食模块：关闭弹窗跳转地图模块（携带 ?restaurant=<id> 深链）。
   */
  const handleLocateOnMap = async () => {
    if (!restaurant || locating) return;
    let lat = restaurant.latitude;
    let lng = restaurant.longitude;
    const hasCoords =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    if (!hasCoords) {
      // 实时反算坐标（On-the-fly Geocoding）
      setLocating(true);
      toast.loading(isEn ? "Locating restaurant..." : "正在定位餐厅…", { id: "r-locate" });
      try {
        const geo = await geocodeVenue({
          name: restaurant.name,
          address: restaurant.address,
          cityKey: restaurant.city,
          countryKey: restaurant.country,
        });
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
          // 写回 Supabase 持久化（等待完成确保地图侧深链拉取能读到新坐标；失败仅警告不阻断）
          try {
            const { error } = await (supabase as any)
              .from("trip_restaurants")
              .update({ latitude: geo.lat, longitude: geo.lng, updated_at: new Date().toISOString() })
              .eq("id", restaurant.id);
            if (error) console.warn("[RestaurantDetailModal] write-back coords failed:", error);
          } catch (err) {
            console.warn("[RestaurantDetailModal] write-back coords error:", err);
          }
        }
      } finally {
        toast.dismiss("r-locate");
        setLocating(false);
      }
      if (lat == null || lng == null) {
        // 严格失败处理：明确报错，绝不降级到城市中心或其它无关地点
        toast.error(
          isEn
            ? "Could not get this restaurant's location. Please check the address or name."
            : "未能获取该餐厅的具体位置，请检查详细地址或餐厅名称",
        );
        return;
      }
    }
    if (onLocateOnMap) {
      onLocateOnMap({ lat: lat as number, lng: lng as number });
      return;
    }
    if (!tripId) return;
    onClose();
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: { restaurant: restaurant.id },
    });
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[1100] flex animate-[fadeIn_0.15s_ease-out_forwards] items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] sm:rounded-3xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-20 rounded-full bg-muted p-2 text-muted-foreground transition-all hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex-1 overflow-y-auto overscroll-contain p-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {/* Header：餐段徽章（扁平线条图标） + 名称 + 城市·国家 */}
            <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold font-mono ${meal.badgeCls}`}>
              <MealIcon className="w-3.5 h-3.5" />
              {isEn ? `${meal.en}` : meal.zh}
            </span>
            <h2 className="mt-3 pr-10 text-2xl font-bold text-foreground">{restaurant.name}</h2>
            {(restaurant.city || restaurant.country) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  getLocalizedLocationName(restaurant.city || "", locale),
                  getLocalizedLocationName(restaurant.country || "", locale),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {/* 信息卡：营业时间 + 地址 + 复制餐厅名称 / 打开地图 */}
            <div className="mt-4 space-y-2.5 rounded-2xl border border-border bg-muted/50 p-4">
              {restaurant.hours && (
                <p className="flex items-start gap-2 text-xs text-foreground">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                  {restaurant.hours}
                </p>
              )}
              {restaurant.address && (
                <p className="flex items-start gap-2 text-xs text-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                  {restaurant.address}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyName}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-all hover:border-brand/50 hover:text-brand active:scale-95"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied
                    ? isEn ? "Copied" : "已复制"
                    : isEn ? "Copy Name" : "复制餐厅名称"}
                </button>
                {mapQuery && (
                  <button
                    type="button"
                    onClick={() => setMapSheetOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-brand-foreground transition-all hover:opacity-90 active:scale-95"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {isEn ? "Open Map" : "打开地图"}
                  </button>
                )}
                {/* 地图定位按钮 — 纯图标圆形按钮（与 Copy Name / Open Map 等高协调，黄色系），
                    紧跟 Open Map 右侧；无坐标时点击实时反算并写回 DB */}
                <button
                  type="button"
                  onClick={handleLocateOnMap}
                  disabled={locating}
                  aria-label={isEn ? "Locate on map" : "地图定位"}
                  title={isEn ? "Locate on map" : "地图定位"}
                  className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-500 transition-all hover:bg-amber-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {locating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* 备注 Tips */}
            {restaurant.notes && (
              <p className="mt-3 flex items-start gap-2 rounded-2xl border border-brand/20 bg-brand/10 p-3.5 text-xs leading-relaxed text-foreground">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                {restaurant.notes}
              </p>
            )}

            {/* 精选菜单 / 必点菜品 */}
            <Section title={isEn ? "Must-Order Dishes" : "精选菜单 / 必点菜品"}>
              <div className="flex flex-col gap-2">
                {restaurant.dishes.map((d) => (
                  <div key={d.id} className="rounded-xl border border-border bg-muted/50 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{d.name}</p>
                      {d.price && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-brand">
                          {d.price}
                        </span>
                      )}
                    </div>
                    {d.note && <p className="mt-1 text-[11px] text-muted-foreground">{d.note}</p>}
                  </div>
                ))}
                {restaurant.dishes.length === 0 && (
                  <p className="text-xs text-muted-foreground">{isEn ? "No recommended dishes yet." : "暂无推荐菜品。"}</p>
                )}
              </div>
            </Section>

            {/* 附件截图 */}
            <Section
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  {isEn ? `Screenshots (${restaurant.attachments.length})` : `攻略截图 (${restaurant.attachments.length})`}
                </span>
              }
            >
              {restaurant.attachments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                  {isEn ? "No screenshots yet — edit to upload." : "还没有攻略截图，编辑餐厅即可上传。"}
                </p>
              ) : (
                <div className={`grid gap-2 ${cols}`}>
                  {restaurant.attachments.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setLightbox(p)}
                      className="group overflow-hidden rounded-xl border border-border bg-muted"
                    >
                      <CachedImage
                        value={p}
                        alt={isEn ? "Guide screenshot" : "攻略截图"}
                        className="h-32 w-full object-cover transition group-hover:scale-105"
                      />
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* 底部：居中圆形铅笔编辑按钮（纯 Icon） */}
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => onEdit(restaurant)}
                aria-label={isEn ? "Edit restaurant" : "编辑餐厅"}
                title={isEn ? "Edit restaurant" : "编辑餐厅"}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground transition-all hover:bg-brand hover:text-brand-foreground hover:shadow-[0_0_14px_rgba(0,242,254,0.45)] active:scale-95"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 多地图导航 ActionSheet — 视觉与地图模块导航选择弹窗一致 */}
      {mapSheetOpen && mapQuery && (
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
              {deepLinks.map((link) => (
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
        </div>
      )}

      {/* 轻量图片查看器（lightbox 状态持有原始值，由 CachedImage 解析；
          攻略截图文字密集 → highRes 走无宽度限制 CDN 通道保证放大可读） */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 backdrop-blur-xl animate-[fadeIn_0.15s_ease-out_forwards]"
          onClick={() => setLightbox(null)}
        >
          <CachedImage
            value={lightbox}
            highRes
            alt={isEn ? "Guide screenshot" : "攻略截图"}
            className="max-h-[90dvh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-slate-200 transition hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
