import { Landmark, Leaf, Soup, type LucideIcon } from "lucide-react";
import type { StampEntry, StampCategory } from "./types";
import { useT } from "@/i18n";
import { usePhotoUrl } from "@/components/signed-image";
import { getOptimizedImageUrl, isPrivateStorageUrl } from "@/lib/utils";
import { getLocalizedLocationName } from "@/utils/location";

export type StampAspect = "portrait" | "landscape" | "square";

/**
 * 强制英文日期格式化（忽略系统语言环境）。
 * 示例输出：AUG 08, 2026
 */
function formatStampDateEN(iso: string): string {
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
  ["--r" as string]: "4px",
  ["--g" as string]: "12px",
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

// aspect-ratio 通过 Tailwind 任意值类强制设定，确保图片网络请求回来之前
// CSS 瀑布流就能算对第 2/3 列高度，避免重排塌陷导致 onError 误触发
const aspectClass: Record<StampAspect, string> = {
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
  square: "aspect-square",
};

// 分类 → Lucide 图标映射（与 StampCard 保持一致）
const CATEGORY_ICON: Record<StampCategory, LucideIcon> = {
  cities: Landmark,
  nature: Leaf,
  food: Soup,
};

export function aspectFor(id: string): StampAspect {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const variants: StampAspect[] = ["portrait", "landscape", "square"];
  return variants[Math.abs(hash) % variants.length];
}

interface Props {
  entry: StampEntry;
  aspect?: StampAspect;
  onClick?: () => void;
  className?: string;
}

export function PostageStamp({ entry, aspect = "portrait", onClick, className = "" }: Props) {
  // t 保留以备未来扩展（当前 PASSPORT 标签已移除，强制英文日期/标题不依赖 i18n）
  void useT();
  // 私密图片链路解析（checkin-images 私密桶 → IndexedDB 缓存 → blob: ObjectURL）
  const resolvedPhoto = usePhotoUrl(entry.photo);
  // 严禁私密桶原生直链（403 破图源头）进入 <img>：
  // - blob: ObjectURL / data: → 缓存链路产物，直接渲染
  // - 公开桶直链 → getOptimizedImageUrl 走 wsrv.nl CDN
  // - 私密桶兜底直链（http）→ 拦截，走城市名渐变占位
  const imgSrc =
    resolvedPhoto && !isPrivateStorageUrl(resolvedPhoto)
      ? getOptimizedImageUrl(resolvedPhoto)
      : "";

  // 右上角圆形印章内的类别图标
  const CategoryIcon = CATEGORY_ICON[entry.category] || Landmark;
  // 主标题：强制提取城市英文名并全大写（忽略系统语言环境）
  // 通过 getLocalizedLocationName(city, "en") 将中文/拼音城市名转为英文，
  // 再调用 toUpperCase() 确保渲染为全大写英文字母（如 JINJIANG / HONGQIAO）
  const titleText = getLocalizedLocationName(entry.city || entry.location || "", "en").toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      // 浅色模式：极其微弱的高斯弥散投影，避免黑边污染相邻邮票
      // 深色模式：保留 drop-shadow-xl 凸显邮票质感
      // transform-gpu translate-z-0 will-change-transform：强制 GPU 硬件加速，
      // 为每个邮票分配独立 GPU 渲染层，防止移动端 mask-image 锯齿边缘 + 多列布局
      // 触发的渲染层裁剪 Bug（第 2/3 列图片隐身）
      // 不写 mb-*：垂直间距由父容器 flex-col gap-4 统一提供，避免与 gap 叠加导致上下间距过大
      className={`group relative block w-full max-w-[170px] break-inside-avoid transition-transform duration-500 hover:scale-[1.03] sm:max-w-[180px] drop-shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] transform-gpu translate-z-0 will-change-transform ${className}`}
    >
      {/* 邮票锯齿边框：浅深模式差异化
          - 浅色模式：p-0 bg-transparent，图片完全铺满直接呈现锯齿边缘
          - 深色模式：dark:p-1.5 dark:bg-white，保留白边 Padding 凸显邮票物理质感 */}
      <div
        className={`relative ${aspectClass[aspect]} w-full p-0 bg-transparent dark:p-1.5 dark:bg-white transform-gpu translate-z-0`}
        style={perforationMask}
      >
        <div className="relative h-full w-full overflow-hidden transform-gpu translate-z-0">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={entry.title}
              draggable={false}
              className="h-full w-full object-cover"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted">
              <span className="text-[8px] font-mono text-muted-foreground">{titleText}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/40" />

          {/* 右上角：圆形印章边框 + 类别 Icon（已删除 STAMPED 文字，替换为 Lucide 图标）
              top-2 right-2 安全距离：浅色模式无 Padding 时防止被锯齿裁切 */}
          <div className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-black/20 backdrop-blur-sm">
            <CategoryIcon className="h-3 w-3 text-white/90" strokeWidth={2} />
          </div>

          {/* 底部：主标题（强制全大写）+ 日期（强制英文格式）
              left-2 right-2 bottom-2 安全距离：浅色模式无 Padding 时防止被锯齿裁切 */}
          <div className="absolute inset-x-2 bottom-2 text-white">
            <p className="font-serif text-xs font-bold leading-tight tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              {titleText}
            </p>
            <p className="mt-0.5 text-[7px] font-medium uppercase tracking-[0.2em] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {formatStampDateEN(entry.createdAt)}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
