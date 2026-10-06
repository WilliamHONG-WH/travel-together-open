import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivateImage } from "@/lib/image-cache";
import { getOptimizedImageUrl, getHighResImageUrl } from "@/lib/utils";

/**
 * 同步/异步统一的 Supabase Storage 图片 URL 解析 Hook（按桶自动分流）。
 *
 * - 私密桶（checkin-images 打卡/小票、avatars 头像）→ 本地 IndexedDB 缓存链路：
 *   内存池 → IndexedDB → supabase.storage.download()（经 RLS 鉴权，仅行程成员可读）。
 *   加载完成返回本地 ObjectURL（0 CDN、0 第三方代理，重复打开 0 网络请求）。
 * - 公开桶（public-images，含 encyclopedia 历史桶）→ 同步公开直链，由调用方套
 *   wsrv.nl CDN 优化（getOptimizedImageUrl / getHighResImageUrl）。
 *
 * 私密图加载中返回 null，渲染层据此显示骨架屏（移动端瀑布流首帧为骨架属预期行为）。
 */
export function usePublicUrl(
  path: string | null | undefined,
  bucket = "checkin-images",
): string | null {
  return usePrivateImage(path, bucket);
}

/**
 * @deprecated 已废弃，保留仅为向后兼容。语义为本地缓存链路解析，
 * 不再调用 `createSignedUrl`。请改用 `usePublicUrl` / `usePhotoUrl`。
 */
export const useSignedUrl = usePublicUrl;

/**
 * 私密图片直渲染组件：Storage 路径 → IndexedDB 缓存链路 → 本地 ObjectURL。
 * 严禁经过 wsrv.nl 等第三方 CDN（私密内容防泄露 + 免 Egress）。
 */
export function SignedImage({
  path,
  bucket = "checkin-images",
  className,
  alt = "",
}: {
  path: string | null | undefined;
  bucket?: string;
  className?: string;
  alt?: string;
}) {
  const url = usePrivateImage(path, bucket);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    // 解析中 / 兜底直链也加载失败 → 中性占位，绝不渲染破图图标
    return <div className={`${className ?? ""} animate-pulse bg-muted/60`} aria-hidden />;
  }
  // 私密图返回 ObjectURL 自动直通；公开桶（百科）直链自动套 wsrv.nl CDN
  return (
    <img
      src={getOptimizedImageUrl(url)}
      alt={alt}
      className={className}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 统一图片 URL 解析 hook：按桶自动分流，兼容多种存储格式。
 *
 * - Base64 DataURL (`data:image/...`) → 直接返回，无需缓存
 * - ObjectURL (`blob:...`) → 直接返回（编辑态本地预览）
 * - 完整外部 http(s) URL（如 Unsplash 百科默认图）→ 直接返回
 * - Supabase Storage 引用 → 私密桶（checkin-images/avatars）走本地 IndexedDB
 *   缓存链路；公开桶（public-images 等）同步返回公开直链（调用方套 CDN）
 */
export function usePhotoUrl(
  photo: string | null | undefined,
  bucket = "checkin-images",
): string | null {
  return usePrivateImage(photo, bucket);
}

/**
 * 统一图片渲染组件：自动解析 Base64 / ObjectURL / http URL / Storage 路径。
 *
 * 渲染分流（存储桶隐私分级）：
 * - Supabase Storage 引用（私密：打卡/发票/头像/自建百科图）→ 本地 IndexedDB
 *   缓存链路，ObjectURL 原样渲染，绝不经过第三方 CDN。
 * - 外部 http(s) URL（公开：百科预置 Unsplash 图等）→ wsrv.nl CDN 代理压缩。
 *
 * 加载体验优化：
 * - 解析/下载期间：显示 animate-pulse 灰色骨架屏
 * - onLoad 触发后：opacity 0→1 平滑过渡显示真实图片，避免突兀闪烁
 * - decoding="async" 防止大图解码阻塞主线程
 * - loading="eager" 立即加载（移动端多列瀑布流下 lazy 会阻止第 2/3 列触发视口相交）
 */
export function PhotoImage({
  src,
  bucket = "checkin-images",
  className,
  alt = "",
  eager = true,
}: {
  src: string | null | undefined;
  bucket?: string;
  className?: string;
  alt?: string;
  /** 是否高优先级加载（默认 true，保持与移动端多列布局兼容） */
  eager?: boolean;
}) {
  const url = usePrivateImage(src, bucket);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // 私密桶返回 ObjectURL → 直通渲染；公开桶（百科）返回公开直链 → wsrv.nl CDN 压缩
  const displaySrc = url ? getOptimizedImageUrl(url) : null;

  // src 切换时重置 loaded 状态，确保新图也能显示骨架屏。
  // 修复二次打开弹窗时图片黑屏 Bug：浏览器缓存导致 onLoad 不触发，
  // img 永远卡在 loaded=false (opacity-0)。通过 useRef 强制校验 img.complete
  // 缓存状态，命中缓存则瞬间无缝显示。
  useEffect(() => {
    setLoaded(false);
    // useEffect 在 React commit 后执行，此时 img 已挂载到 DOM。
    // 若图片已被浏览器缓存，img.complete 会立即为 true，强制显示避免黑屏。
    if (imgRef.current && imgRef.current.complete) {
      setLoaded(true);
    }
  }, [displaySrc]);

  // URL 解析中或无图：显示骨架屏占位
  if (!displaySrc) {
    return <div className={`${className ?? ""} animate-pulse bg-muted/60`} aria-hidden />;
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* 骨架屏背景：图片加载完成前显示，平滑淡出 */}
      {!loaded && (
        <div
          className="absolute inset-0 animate-pulse bg-muted/60"
          aria-hidden
        />
      )}
      <img
        ref={imgRef}
        src={displaySrc}
        alt={alt}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CachedImage — 通用私密图片 <img>（头像/小图等轻量场景）
// ─────────────────────────────────────────────────────────────────────────
// 任意格式值（Storage 路径 / Supabase 完整 URL / data: / blob: / 外部 http），
// 私密引用走 IndexedDB 缓存链路（加载中渲染同尺寸骨架占位），公开桶直链与
// 外部 URL 自动套 wsrv.nl 代理。除 src/解析逻辑外属性原样透传给 <img>。
// ─────────────────────────────────────────────────────────────────────────

export function CachedImage({
  value,
  bucket = "checkin-images",
  className,
  alt = "",
  eager = true,
  highRes = false,
  ...imgProps
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  value: string | null | undefined;
  bucket?: string;
  eager?: boolean;
  /** 全屏高清预览（如票据/攻略截图 Lightbox）：公开直链走无宽度限制 CDN 通道 */
  highRes?: boolean;
}) {
  const url = usePrivateImage(value, bucket);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  // 私密桶 ObjectURL 直通；公开桶直链 / 外部 URL 自动上 CDN（highRes 不限宽度）
  const displaySrc = url
    ? highRes
      ? getHighResImageUrl(url)
      : getOptimizedImageUrl(url)
    : null;

  if (!displaySrc || failed) {
    // 解析中 / 兜底直链也加载失败 → 中性占位，绝不渲染破图图标
    return <div className={`${className ?? ""} animate-pulse bg-muted/60`} aria-hidden />;
  }
  return (
    <img
      {...imgProps}
      src={displaySrc}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={(e) => {
        setFailed(true);
        imgProps.onError?.(e);
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 两级图片加载降级机制 (Image Loading Fallback)
// ─────────────────────────────────────────────────────────────────────────
// 加载策略（依次降级）：
// 1. rawUrl 为私密 ObjectURL（缓存链路产物）→ 原样渲染（getOptimizedImageUrl
//    对 ObjectURL 直通，不产生第二次降级路径）
// 2. rawUrl 为外部公开 URL → 优先 wsrv.nl CDN，onError 降级原始直链
// 3. 仍失败 → 标记 failed，由调用方渲染占位图
//
// rawUrl 变化时自动重置 stage，保证列表滚动/数据刷新时重试链路完整。
// ─────────────────────────────────────────────────────────────────────────

type FallbackStage = "optimized" | "raw" | "failed";

export function useImageWithFallback(rawUrl: string | null | undefined) {
  // 预计算代理 URL（rawUrl 变化时自动重算，useMemo 保证同步可用；
  // ObjectURL / data: 等非 Supabase 地址原样直通）
  const optimizedUrl = useMemo(
    () => (rawUrl ? getOptimizedImageUrl(rawUrl) : ""),
    [rawUrl],
  );

  // 初始 stage 同步取值：rawUrl 可用时直接 optimized，避免首次渲染 src 为空
  const [stage, setStage] = useState<FallbackStage>(() =>
    rawUrl ? "optimized" : "failed",
  );

  // rawUrl 变化（数据刷新/列表复用）时重置阶段，重新走完整降级链路。
  useEffect(() => {
    setStage(rawUrl ? "optimized" : "failed");
  }, [rawUrl, optimizedUrl]);

  const src =
    stage === "failed" ? "" : stage === "raw" ? rawUrl ?? "" : optimizedUrl;

  // onError 回调：optimized → raw → failed 逐级降级
  const onError = useCallback(() => {
    setStage((prev) => (prev === "optimized" ? "raw" : "failed"));
  }, []);

  return { src, failed: stage === "failed", onError };
}

/**
 * FallbackImage — 内置两级降级的 <img> 组件。
 *
 * - 自动套用 useImageWithFallback 的 optimized → raw → 失败降级链路
 * - 失败时调用 onFallback 回调，由调用方决定占位 UI（不强制渲染灰底）
 * - 默认补充 decoding="async" / loading="eager"
 *   优化移动端 Safari 图片加载兼容性，且多列瀑布流下不会因 lazy 错过视口触发
 *
 * 用于邮票卡片 (PostageStamp / StampCard) 等对移动端显示稳定性要求高的场景。
 */
export function FallbackImage({
  rawUrl,
  alt = "",
  className,
  onLoad,
  onFallback,
  eager = true,
}: {
  rawUrl: string | null | undefined;
  alt?: string;
  className?: string;
  onLoad?: () => void;
  /** 图片彻底加载失败（两级降级均失败）时触发，调用方可渲染占位图 */
  onFallback?: () => void;
  /** 是否高优先级加载（默认 true，移动端多列布局必须 eager） */
  eager?: boolean;
}) {
  const { src, failed, onError } = useImageWithFallback(rawUrl);

  // 两级降级均失败 → 通知调用方渲染占位 UI
  useEffect(() => {
    if (failed && onFallback) onFallback();
  }, [failed, onFallback]);

  if (!src || failed) {
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
    />
  );
}
