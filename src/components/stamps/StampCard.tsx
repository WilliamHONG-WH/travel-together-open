import { Star, Landmark, Leaf, Soup } from "lucide-react";
import type { StampEntry, StampCategory } from "./types";
import { useI18n } from "@/i18n";
import { getLocalizedLocationText, getLocalizedLocationName } from "@/utils/location";
import { usePhotoUrl } from "@/components/signed-image";
import { getOptimizedImageUrl, isPrivateStorageUrl } from "@/lib/utils";
import { MemberAvatar } from "@/components/member-avatar";

interface Props {
  entry: StampEntry;
  onClick: () => void;
  onToggleFeatured: (id: string) => void;
}

// 分类徽章配置：Lucide 图标 + 发光圆环颜色 (与地图打卡页 100% 一致)
const CATEGORY_BADGE: Record<
  StampCategory,
  { Icon: typeof Landmark; ring: string; iconColor: string }
> = {
  cities: {
    Icon: Landmark,
    ring: "border-teal-500/60 bg-teal-50/90 dark:border-brand/60 dark:bg-brand/10",
    iconColor: "text-teal-600 dark:text-brand",
  },
  nature: {
    Icon: Leaf,
    ring: "border-emerald-500/60 bg-emerald-50/90 dark:border-emerald-400/60 dark:bg-emerald-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  food: {
    Icon: Soup,
    ring: "border-orange-400/60 bg-orange-50/90 dark:border-amber-400/60 dark:bg-amber-500/10",
    iconColor: "text-orange-500 dark:text-amber-400",
  },
};

// 强制英文日期格式（忽略系统语言环境），示例：AUG 01, 2026
function formatFullDateEN(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`;
  } catch {
    return "";
  }
}

export function StampCard({ entry, onClick, onToggleFeatured }: Props) {
  const { locale } = useI18n();
  // 私密图片链路解析（checkin-images / avatars 私密桶 → IndexedDB 缓存 → blob: ObjectURL）
  const publicPhoto = usePhotoUrl(entry.photo);
  const publicAvatar = usePhotoUrl(entry.creator?.avatar_url ?? null, "avatars");
  // 严禁私密桶原生直链（403 破图源头）进入 <img>：
  // - blob: ObjectURL / data: → 缓存链路产物，直接渲染
  // - 公开桶直链 → getOptimizedImageUrl 走 wsrv.nl CDN
  // - 私密桶兜底直链（http）→ 拦截，走渐变占位（头像由 MemberAvatar 内部兜底）
  const imgSrc =
    publicPhoto && !isPrivateStorageUrl(publicPhoto)
      ? getOptimizedImageUrl(publicPhoto)
      : "";
  // 统一调用 getLocalizedLocationText：与地图弹窗 / 足迹详情弹窗三处联动
  // 中文模式自动剥离 City/市 后缀 + 拼音扩展字典兜底（如 Hongqiao → 虹桥）
  const locationText = getLocalizedLocationText(entry.city ?? "", entry.country ?? "", locale);
  const badge = CATEGORY_BADGE[entry.category] || CATEGORY_BADGE.cities;
  const BadgeIcon = badge.Icon;
  // 强制英文日期格式（忽略系统语言环境）
  const dateLabel = formatFullDateEN(entry.createdAt);
  // 主标题：强制提取城市英文名并全大写（忽略系统语言环境）
  // 不使用 entry.title（用户自定义标题），确保全 App 邮票下方第一行永远显示大写英文城市名
  const titleText = getLocalizedLocationName(entry.city || entry.location || "", "en").toUpperCase();

  return (
    <div
      // 浅色模式：极弱高斯弥散投影替代 shadow-sm，避免多列卡片阴影互相切割
      // 深色模式：保留 shadow-md 凸显卡片层级
      className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-border bg-white dark:bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-md transition-all hover:border-slate-300 dark:hover:border-border cursor-pointer"
      onClick={onClick}
    >
      {/* 1. 上半部分：正方形图片 (aspect-square 强制高度，防瀑布流塌陷) + 3 个悬浮 Icon */}
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-slate-100 dark:bg-muted">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={entry.title}
            className="h-full w-full object-cover"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted" />
        )}

        {/* 左上角：与地图页一致的分类 Icon */}
        <div
          className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border backdrop-blur-md ${badge.ring} ${badge.iconColor} shadow-md`}
        >
          <BadgeIcon className="h-3.5 w-3.5" />
        </div>

        {/* 右上角：圆环发光星标 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFeatured(entry.id);
          }}
          className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-all active:scale-95 shadow-md ${
            entry.isFeatured
              ? "border-amber-400/80 bg-amber-500/20 text-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)]"
              : "border-slate-200/80 bg-white/80 text-slate-400 hover:text-slate-600 dark:border-border/80 dark:bg-muted/80 dark:text-muted-foreground dark:hover:text-foreground"
          }`}
        >
          <Star
            className={`h-3 w-3 ${
              entry.isFeatured ? "fill-amber-400 text-amber-400" : ""
            }`}
            fill={entry.isFeatured ? "currentColor" : "none"}
          />
        </button>

        {/* 右下角：打卡人微型头像 — 全站统一 MemberAvatar（真实头像 → 专属色首字母圆） */}
        <div className="absolute bottom-2 right-2 z-10 h-5 w-5 overflow-hidden rounded-full border border-border shadow-md">
          <MemberAvatar
            fallbackId={entry.creator?.userId}
            fallbackName={entry.creator?.name}
            fallbackAvatar={publicAvatar}
            textClassName="text-[8px] font-bold"
          />
        </div>
      </div>

      {/* 2. 切割线 */}
      <div className="w-full border-t border-slate-200/80 dark:border-border" />

      {/* 3. 下半部分：高度紧凑压缩的文字排版区 */}
      <div className="flex flex-1 flex-col justify-between px-2 py-1.5">
        <div>
          <h3 className="truncate text-xs font-bold leading-tight text-slate-900 dark:text-foreground">{titleText}</h3>
          {locationText && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-500 dark:text-muted-foreground">{locationText}</p>
          )}
        </div>

        {/* 日期完整展示 (去除了 BY USER) */}
        <div className="mt-1 truncate text-[9px] font-bold leading-none tracking-wider text-teal-600 dark:text-brand">
          {dateLabel || "RECENT"}
        </div>
      </div>
    </div>
  );
}
