import type { Receipt } from "./types";

/**
 * 票据图片工具。
 *
 * 票据图片存于私密桶 checkin-images（Storage 相对路径 `tripId/userId/uuid.jpg`），
 * 渲染一律经由 src/lib/image-cache.ts 的本地 IndexedDB 缓存链路
 * （usePrivateImage / CachedImage / SignedImage）——经 RLS 鉴权下载后本地持久缓存，
 * 重复打开 0 网络请求、0 Supabase Egress，且绝不经过 wsrv.nl 等第三方 CDN。
 * 历史的 resolveStorageUrl / resolveReceiptImageUrl（getPublicUrl 公开直链）已随
 * 存储桶私密化删除。
 */

/**
 * 获取票据的全部图片（向下兼容）：
 * - 新数据：images 数组优先
 * - 旧数据：仅 image_url 时自动转为 [image_url]
 */
export function getReceiptImages(receipt: Pick<Receipt, "images" | "image_url">): string[] {
  const imgs = Array.isArray(receipt?.images)
    ? receipt.images.filter((p): p is string => !!p)
    : [];
  if (imgs.length > 0) return imgs;
  return receipt?.image_url ? [receipt.image_url] : [];
}
