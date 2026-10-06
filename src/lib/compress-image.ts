/**
 * Client-side image compression using Canvas API.
 * Downscales large dimensions and iteratively lowers JPEG quality
 * until the encoded blob is <= maxBytes (default 350 KB, maxDim 1280px).
 *
 * 安卓 Chrome 兼容性：
 * - 严格限制 Canvas 最大宽高为 1280px，避免大图（10MB+）绘制时内存溢出（OOM）。
 * - 使用 canvas.toBlob() 输出二进制 Blob，避免 canvas.toDataURL() 的 Base64 内存膨胀。
 * - 解码/绘制阶段 try-catch 兜底：极小尺寸（640px/q0.3） desperate 重试；仍失败时
 *   仅允许 ≤500KB 的原图通过，>500KB 抛 IMAGE_TOO_LARGE 提示用户截屏后重试。
 * - 使用 ImageBitmap.close() 释放位图资源，避免内存泄漏。
 *
 * iPhone HEIC 治理：
 * - HEIC/HEIF 文件（扩展名 .heic/.heif 或 MIME image/heic|heif）在进入压缩前
 *   先经 heic2any 统一转为标准 image/jpeg —— Windows Chrome/Edge 无法解码 HEIC，
 *   原始 HEIC 一旦上云，队友端必然破图。
 * - 严禁静默回退上传原始 HEIC/巨图：压缩失败逐档降级质量与尺寸，
 *   任何 >500KB 的未压缩原图绝不允许流入 Supabase（防爆流量）。
 */
import { supabase } from "@/integrations/supabase/client";

/** 上传硬闸：任何超过该字节数的图片绝不允许进入 Supabase Storage */
const UPLOAD_HARD_LIMIT = 500 * 1024;

/** 判断文件是否为 iPhone HEIC/HEIF 格式（扩展名或 MIME） */
export function isHeicFile(file: File): boolean {
  if (/\.hei[cf]s?$/i.test(file.name || "")) return true;
  const t = (file.type || "").toLowerCase();
  return t === "image/heic" || t === "image/heif" || t === "image/heic-sequence";
}

/**
 * HEIC/HEIF → JPEG 预转码（动态加载 heic2any，非 HEIC 场景零开销）。
 * 转码失败抛错由调用方兜底 —— 绝不静默放行原始 HEIC。
 */
async function heicToJpeg(blob: Blob, quality = 0.9): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob, toType: "image/jpeg", quality });
  const jpeg = Array.isArray(out) ? out[0] : out;
  if (!jpeg || jpeg.size === 0) throw new Error("HEIC transcode produced empty output");
  return jpeg;
}

/** 提取 HEIC 转码产物为 File(统一走 JPEG 压缩管线) */
function asJpegFile(blob: Blob, name = "image.jpg"): File {
  return new File([blob], name.replace(/\.[^/.]+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

/**
 * Canvas 压缩内核：Blob → 限尺寸 + 迭代降质量 JPEG。
 * 失败直接抛错（无兜底），由调用方决定降级策略。
 */
async function compressBlobViaCanvas(
  source: Blob,
  maxDim: number,
  maxBytes: number,
  qualities: number[],
): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;

  try {
    // 阶段 1：解码（OOM 高发点，特别是 10MB+ 大图）
    bitmap = await createImageBitmap(source).catch(() => null);

    let width: number;
    let height: number;
    let canvasSource: CanvasImageSource;

    if (bitmap) {
      width = bitmap.width;
      height = bitmap.height;
      canvasSource = bitmap;
    } else {
      // Fallback via <img>
      objectUrl = URL.createObjectURL(source);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objectUrl!;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      canvasSource = img;
    }

    // 阶段 2：按比例缩放，严格限制最大宽高
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    // drawImage 是 OOM 关键点：安卓 Chrome 对大尺寸 Canvas 绘制极度敏感
    ctx.drawImage(canvasSource, 0, 0, targetW, targetH);

    // 阶段 3：迭代降质量直到满足大小要求
    let last: Blob | null = null;
    for (const q of qualities) {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", q),
      );
      if (!blob) continue;
      last = blob;
      if (blob.size <= maxBytes) return blob;
    }

    // 仍然过大 — 进一步缩小尺寸重试一次
    if (last && last.size > maxBytes) {
      const w2 = Math.round(targetW * 0.7);
      const h2 = Math.round(targetH * 0.7);
      canvas.width = w2;
      canvas.height = h2;
      ctx.drawImage(canvasSource, 0, 0, w2, h2);
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.6),
      );
      if (blob) last = blob;
    }

    if (!last) throw new Error("Image compression failed");
    return last;
  } finally {
    // 释放资源，避免内存泄漏
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        // 某些旧浏览器不支持 close()，忽略
      }
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function compressImage(
  file: File,
  opts: { maxBytes?: number; maxDim?: number; qualities?: number[] } = {},
): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? 350_000;
  const maxDim = opts.maxDim ?? 1280;

  // 阶段 0：HEIC/HEIF 预转码 —— 统一转 JPEG 后再走常规压缩管线
  let source: Blob = file;
  try {
    if (isHeicFile(file)) {
      source = await heicToJpeg(file, 0.92);
    }
  } catch (err) {
    console.error("[compressImage] HEIC 预转码失败，拒绝上传原始 HEIC:", err);
    throw new Error("IMAGE_TOO_LARGE");
  }

  // 小于 200KB 的文件直接返回，避免无谓的解码/编码开销
  // （HEIC 已在上一步强制转码，此处 source 必为可解码格式）
  if (source.size < 200 * 1024) {
    return source;
  }

  try {
    return await compressBlobViaCanvas(
      source,
      maxDim,
      maxBytes,
      opts.qualities ?? [0.8, 0.75, 0.65, 0.55, 0.45],
    );
  } catch (err) {
    // OOM / Canvas 处理失败 — desperate 降级（严禁静默回退上传原图）：
    // 1. 极小尺寸（640px / q0.5→0.3）再搏一次 —— 通常可压进 500KB；
    // 2. 仍失败：仅当原图 ≤500KB 时放行，>500KB 一律拒绝上云。
    try {
      const desperate = await compressBlobViaCanvas(
        source,
        640,
        UPLOAD_HARD_LIMIT,
        [0.5, 0.4, 0.3],
      );
      if (desperate.size <= UPLOAD_HARD_LIMIT) {
        console.warn("[compressImage] Canvas 处理失败，desperate 压缩兜底成功:", err);
        return desperate;
      }
    } catch (desperateErr) {
      console.warn("[compressImage] desperate 压缩仍失败:", desperateErr);
    }
    if (source.size <= UPLOAD_HARD_LIMIT) {
      console.warn("[compressImage] 压缩失败，原图 ≤500KB 放行:", err);
      return source;
    }
    console.error("[compressImage] 图片过大且压缩失败，拒绝上传 >500KB 原图:", err);
    throw new Error("IMAGE_TOO_LARGE");
  }
}

/**
 * 将 Blob 转换为 base64 Data URL 字符串。
 * 用于将压缩后的图片 Blob 转换为可直接存入数据库字段的 base64 字符串。
 */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 压缩图片并返回 base64 Data URL 字符串。
 * 便捷封装：compressImage + blobToDataURL。
 * 适用于将图片以 base64 形式存入数据库字段的场景（百科/票据/打卡详情等模块）。
 *
 * @param file 原始 File 对象
 * @param opts 压缩选项 { maxBytes, maxDim }
 * @returns 压缩后的 base64 Data URL 字符串
 */
export async function compressImageToDataURL(
  file: File,
  opts: { maxBytes?: number; maxDim?: number } = {},
): Promise<string> {
  const blob = await compressImage(file, opts);
  return blobToDataURL(blob);
}

/**
 * 压缩图片并返回 File 对象（用于上传至 Supabase Storage）。
 *
 * 默认参数：最大边长 1280px，目标文件 ≤ 350KB（150~350KB 极限压缩标准），
 * JPEG 迭代降质量。压缩后统一输出 image/jpeg 格式，文件名替换为 .jpg 后缀。
 *
 * @param file 原始 File 对象
 * @param maxDim 最大边长 (默认 1280)
 * @param maxBytes 目标文件大小上限 (默认 350KB)
 * @returns 压缩后的 File 对象
 */
export async function compressImageToFile(
  file: File,
  maxDim = 1280,
  maxBytes = 350 * 1024,
): Promise<File> {
  const blob = await compressImage(file, { maxDim, maxBytes });
  const fileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
  return new File([blob], fileName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

/**
 * 压缩图片并上传至 Supabase Storage，返回 Storage 相对路径。
 * 彻底废除 Base64 — 数据库仅存路径字符串，避免 20MB+ 流量黑洞。
 *
 * RLS 约束：checkin-images bucket 要求路径第二段 = auth.uid()，
 * 因此 pathPrefix 必须为 `${tripId}/${userId}` 格式。
 *
 * @param file 原始 File 对象
 * @param pathPrefix 路径前缀 (如 `${tripId}/${userId}`)
 * @param bucket Storage bucket 名称 (默认 checkin-images)
 * @param opts.precompressed 文件已在选图阶段压缩过（如百科模块），跳过二次压缩
 *   —— 安卓移动端重复 Canvas 解码/编码是 OOM 高发点，保存失败的主嫌疑
 * @returns Storage 相对路径 (如 `${tripId}/${userId}/${uuid}.jpg`)
 */
export async function uploadImageToStorage(
  file: File,
  pathPrefix: string,
  bucket = "checkin-images",
  opts: { precompressed?: boolean } = {},
): Promise<string> {
  // 双重压缩防护：选图时已压缩过的文件直接上传，避免移动端二次 Canvas 操作失败。
  // 例外：HEIC/HEIF 无论是否"已压缩"都强制走转码压缩管线 —— 原始 HEIC 绝不上云。
  let compressed =
    opts.precompressed && !isHeicFile(file) ? file : await compressImageToFile(file);
  // 上传前硬闸：>500KB 的图片（含 precompressed 漏网巨图）强制二次极限压缩，
  // 仍超限则拒绝上传 —— 绝不允许 >500KB 未压缩原图流入 Supabase（防爆流量）。
  if (compressed.size > UPLOAD_HARD_LIMIT) {
    compressed = await compressImageToFile(
      asJpegFile(compressed),
      1024,
      UPLOAD_HARD_LIMIT,
    );
    if (compressed.size > UPLOAD_HARD_LIMIT) {
      console.error(
        `[uploadImageToStorage] 极限压缩后仍超限 (${(compressed.size / 1024).toFixed(0)}KB)，拒绝上传`,
      );
      throw new Error("IMAGE_TOO_LARGE");
    }
  }
  const filePath = `${pathPrefix}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, compressed, {
      contentType: "image/jpeg",
      cacheControl: "3600000",
      upsert: false,
    });
  if (error) throw error;
  return filePath;
}

/**
 * 高清导览图专用压缩通道 — 与普通打卡照片的压缩策略完全不同：
 *
 * 地图类图片文字细小密集，绝不能被极度压缩（否则房间号/导览标注全部模糊）。
 * - 最大边长放宽至 4096px（保留高清文字）
 * - 文件大小上限放宽至 2MB
 * - 文件本身 ≤ 2MB 时直接原样返回（零质量损失，保留 PNG 等原始格式）
 * - 超过 2MB 时才走 Canvas 压缩，质量档位从 0.92 起（远高于普通照片的 0.8）
 *
 * @param file 原始 File 对象
 * @returns 压缩后的 Blob（可能是未处理的原始 File）
 */
export async function compressHighResImage(file: File): Promise<Blob> {
  // HEIC/HEIF 预转码：即便 ≤2MB 也不允许原始 HEIC 上云（浏览器无法解码）
  const source: Blob = isHeicFile(file) ? await heicToJpeg(file, 0.92) : file;
  // ≤ 2MB 的文件无需压缩，原样上传（保留原始格式与全部细节）
  if (source.size <= 2 * 1024 * 1024) {
    return source;
  }
  return compressImage(
    asJpegFile(source, file.name),
    {
      maxDim: 4096,
      maxBytes: 2 * 1024 * 1024,
      qualities: [0.92, 0.88, 0.82, 0.75],
    },
  );
}

/**
 * 高清导览图上传至 Supabase Storage，返回 Storage 相对路径。
 *
 * 与 uploadImageToStorage 的差异：
 * - 走 compressHighResImage 高清通道（4096px / 2MB），绕过普通照片的 1280px 强压缩
 * - 保留原始格式扩展名（png/webp/jpg），未压缩文件零质量损失直传
 * - cacheControl: '3600000' 强缓存头，配合 wsrv.nl CDN 边缘缓存免除 Egress 流量
 *
 * @param file 原始 File 对象
 * @param pathPrefix 路径前缀 (如 `${tripId}/${userId}`)
 * @param bucket Storage bucket 名称 (默认 checkin-images)
 * @returns Storage 相对路径 (如 `${tripId}/${userId}/${uuid}.png`)
 */
export async function uploadHighResImageToStorage(
  file: File,
  pathPrefix: string,
  bucket = "checkin-images",
): Promise<string> {
  const blob = await compressHighResImage(file);
  // 未压缩直传时保留原始格式；Canvas 压缩产物固定为 image/jpeg
  const contentType = blob.type || "image/jpeg";
  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";
  const filePath = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, blob, {
      contentType,
      cacheControl: "3600000",
      upsert: false,
    });
  if (error) throw error;
  return filePath;
}
