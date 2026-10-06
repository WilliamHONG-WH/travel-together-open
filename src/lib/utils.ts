import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 私密桶清单：这些桶的图片严禁经过 wsrv.nl 等第三方 CDN 代理 ——
 * 私人照片/小票/头像被公共 CDN 缓存即属隐私泄露，且私密桶直链会 403。
 * 私密图片一律走 src/lib/image-cache.ts 的本地 IndexedDB 缓存链路。
 */
const PRIVATE_STORAGE_BUCKETS = ["checkin-images", "avatars"];

/**
 * 判断是否为私密桶的 Supabase Storage URL（公开直链/签名直链）。
 * 私密桶（checkin-images / avatars）直链未经鉴权必然 403/400，
 * **严禁直接绑定给 <img src>**（破图）——自绘 <img> 的组件渲染前必须用此函数
 * 拦截，仅允许缓存链路产物（blob: ObjectURL / data:）与公开桶直链上屏。
 */
export function isPrivateStorageUrl(url: string): boolean {
  return PRIVATE_STORAGE_BUCKETS.some(
    (b) =>
      url.includes(`/storage/v1/object/public/${b}/`) ||
      url.includes(`/storage/v1/object/authenticated/${b}/`) ||
      url.includes(`/storage/v1/object/sign/${b}/`),
  );
}

/**
 * 图片 URL 优化：对 Supabase Storage **公开资产**（如百科图片）走 wsrv.nl
 * 免费 CDN 代理，实时压缩为 WebP + 限制宽度，避免直接拉取原图消耗大量 Egress。
 *
 * - Supabase Storage 公开 URL → 经 wsrv.nl 代理（WebP + 指定宽度）
 * - 私密桶 URL（checkin-images / avatars）→ 原样返回，绝不送第三方 CDN（熔断保护）
 * - base64 DataURL / ObjectURL / 非 Supabase URL → 原样返回（无法也不应代理）
 *
 * @param url 原始图片 URL
 * @param width 目标宽度（默认 800）
 * @param quality WebP 质量 0-100（默认 80）
 */
export function getOptimizedImageUrl(
  url: string | null | undefined,
  width = 800,
  quality = 80,
): string {
  if (!url) return "";
  // 仅代理 Supabase Storage 公开图片；私密桶熔断直通（由本地缓存链路接管）
  if (url.includes("supabase.co/storage") && !isPrivateStorageUrl(url)) {
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=${quality}&output=webp`;
  }
  return url;
}

/**
 * 高清导览图专用 CDN 代理：针对地图类图片（文字细小密集）不做任何宽度限制
 * （无 w 参数），仅转 WebP + 极高画质 (q=95)。
 *
 * - 白嫖 Cloudflare/wsrv.nl 边缘缓存，免除 Supabase Storage Egress 流量
 * - 保持原始分辨率输出，确保放大缩放后地图文字（房间号/导览标注）绝对清晰
 * - 私密桶 URL 熔断直通（同 getOptimizedImageUrl，绝不送第三方 CDN）
 * - base64 DataURL / ObjectURL / 非 Supabase URL → 原样返回
 */
export function getHighResImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.includes("supabase.co/storage") && !isPrivateStorageUrl(url)) {
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&q=95&output=webp`;
  }
  return url;
}
