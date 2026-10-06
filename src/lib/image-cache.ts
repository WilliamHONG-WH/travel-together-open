import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────
// 私密图片本地缓存 (Private Image Cache — IndexedDB)
// ─────────────────────────────────────────────────────────────────────────
// 背景：checkin-images（打卡照片/小票发票）与 avatars（用户头像）为私密桶
// （storage.buckets.public = false），历史使用的 getPublicUrl 公开直链已 403。
//
// 核心策略（省 Supabase Egress + 隐私安全）：
// 1. 首次加载：supabase.storage.from(bucket).download(path) 经鉴权下载 Blob
//    （走 RLS 行级安全：仅行程成员可读），存入浏览器 IndexedDB 持久缓存，
//    再 URL.createObjectURL(blob) 本地渲染。
// 2. 再次加载：直接命中 IndexedDB/内存池 → 本地秒开，0 网络请求、0 Egress。
// 3. 严禁第三方 CDN：私密内容绝不经过 wsrv.nl 等公共代理（防缓存泄密）。
//
// 兼容性：数据库中可能存有三种历史格式 —— Storage 相对路径、
// getPublicUrl 生成的完整公开 URL（如 profiles.avatar_url）、
// data: Base64 / blob: 本地预览 / 外部 http(s) URL（百科 Unsplash 图）。
// parseStorageRef 统一归一化：前两类 → (bucket, path) 走缓存链路；
// 后三类原样透传（渲染层再决定是否套 CDN 优化）。
// ─────────────────────────────────────────────────────────────────────────

/** 私密存储桶清单：这些桶的图片严禁走任何第三方 CDN 代理 */
export const PRIVATE_BUCKETS = ["checkin-images", "avatars"] as const;

/**
 * 公开存储桶清单：无隐私的公共旅行参考资料（百科/酒店/餐厅图片）。
 * 这些桶的图片走公开直链 + wsrv.nl CDN 代理（不入本地缓存、不占设备存储），
 * CDN 边缘缓存命中时 0 Supabase Egress。
 *
 * public-images：现行公开桶（优先）；encyclopedia：历史桶名，仅为兼容
 * 存量数据中的旧公开直链（/object/public/encyclopedia/...）保留识别。
 */
export const PUBLIC_BUCKETS = ["public-images", "encyclopedia"] as const;

function isPublicBucket(bucket: string): boolean {
  return (PUBLIC_BUCKETS as readonly string[]).includes(bucket);
}

export interface StorageRef {
  bucket: string;
  path: string;
}

/** 全部已知桶名：用于识别"误把桶名拼进相对路径"的历史数据 */
const KNOWN_BUCKETS = [...PRIVATE_BUCKETS, ...PUBLIC_BUCKETS] as readonly string[];

/**
 * 将任意图片字段值归一化为 StorageRef（bucket + path）。
 *
 * - data:/blob: → null（本地数据，透传）
 * - 完整 Supabase Storage URL（含历史 getPublicUrl 存量与签名 URL，可带 query）→ 反解 bucket+path
 * - 无域名相对形式（`storage/v1/object/public/<bucket>/<path>`、`object/public/...`）→ 反解
 * - 误带桶名前缀的相对路径（`checkin-images/{tripId}/{userId}/{uuid}.jpg`）→ 剥离桶名
 * - 两段式历史路径（`{tripId}/{uuid}.jpg`，老版本上传产物）→ 原样透传，
 *   交由 storage RLS 的文本比较策略（trip_id::text = 首段）放行队友查看
 * - 其他外部 http(s) URL（Unsplash 百科图等）→ null（透传）
 */
export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = "checkin-images",
): StorageRef | null {
  if (!value) return null;
  if (value.startsWith("data:") || value.startsWith("blob:")) return null;

  const toRef = (bucket: string, path: string): StorageRef => {
    try {
      return { bucket: decodeURIComponent(bucket), path: decodeURIComponent(path) };
    } catch {
      return { bucket, path };
    }
  };

  // 1) 完整 URL：/storage/v1/object/{public|authenticated|sign}/{bucket}/{path}[?query]
  const m = value.match(
    /\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/?]+)\/(.+?)(?:\?.*)?$/,
  );
  if (m) return toRef(m[1], m[2]);

  if (/^https?:\/\//i.test(value)) return null; // 外部图（Unsplash 等）→ 透传

  // 2) 无域名的相对 object 形式（手工拼接/导出数据常见）：剥离到 path
  let path = value.replace(/^\/+/, "").replace(/\?.*$/, "");
  const relM = path.match(
    /^(?:storage\/v1\/)?object\/(?:public|authenticated|sign)\/([^/?]+)\/(.+)$/,
  );
  if (relM) return toRef(relM[1], relM[2]);

  // 2.5) 半截 URL 形式（getPublicUrl 结果被截去域名/桶名前的情况）：
  //      `public/<bucket>/<path>` → 剥离 public/ 段反解桶名，防止 path 多出
  //      一层前缀传给 download() 造成"文件真实存在却 404"
  const pubM = path.match(/^public\/([^/?]+)\/(.+)$/);
  if (pubM) return toRef(pubM[1], pubM[2]);

  // 3) 误把桶名拼进相对路径：`<bucket>/<path>` → 剥离桶名前缀
  //    （行程 ID 为 UUID，永远不会与桶名重合，无误伤可能）
  for (const b of KNOWN_BUCKETS) {
    if (path.startsWith(`${b}/`)) {
      return { bucket: b, path: path.slice(b.length + 1) };
    }
  }

  // 4) 普通相对路径（三段式 `{tripId}/{userId}/{uuid}.jpg` 或两段式
  //    `{tripId}/{uuid}.jpg`）：原样透传给 download()，RLS 决定可见性
  return { bucket: defaultBucket, path };
}

// ─────────────────────────────────────────────────────────────────────────
// IndexedDB 持久层
// ─────────────────────────────────────────────────────────────────────────

const DB_NAME = "shanhai-img-cache-v2";
const STORE = "blobs";
/** 上一代缓存库名：首连新库时清除，强制废弃历史损坏/空 Blob 缓存（防缓存投毒） */
const LEGACY_DB_NAME = "ltt-private-image-cache";
/** 持久缓存总量上限（LRU 淘汰最旧记录） */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** 内存 ObjectURL 池上限（仅回收引用数为 0 的条目） */
const MEMORY_POOL_MAX = 80;

interface CacheRecord {
  blob: Blob;
  size: number;
  ts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => {
        // 新库首次成功打开后异步清除上一代损坏缓存库（静默，失败无碍）
        try {
          indexedDB.deleteDatabase(LEGACY_DB_NAME);
        } catch {
          // ignore
        }
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
  }
  return dbPromise;
}

function idbGet(key: string): Promise<CacheRecord | undefined> {
  return openDb().then(
    (db) =>
      new Promise<CacheRecord | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as CacheRecord | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(key: string, rec: CacheRecord): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbDelete(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      }),
  );
}

/** 缓存超限时按 ts 淘汰最旧记录（静默失败，不影响渲染） */async function idbTrim(): Promise<void> {
  try {
    const db = await openDb();
    const entries = await new Promise<{ key: IDBValidKey; size: number; ts: number }[]>(
      (resolve) => {
        const out: { key: IDBValidKey; size: number; ts: number }[] = [];
        const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) {
            const v = cur.value as CacheRecord | undefined;
            if (v) out.push({ key: cur.key, size: v.size ?? 0, ts: v.ts ?? 0 });
            cur.continue();
          } else {
            resolve(out);
          }
        };
        req.onerror = () => resolve(out);
      },
    );
    const total = entries.reduce((s, e) => s + e.size, 0);
    if (total <= MAX_TOTAL_BYTES) return;
    let excess = total - MAX_TOTAL_BYTES;
    const doomed = entries.sort((a, b) => a.ts - b.ts);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const e of doomed) {
      if (excess <= 0) break;
      store.delete(e.key);
      excess -= e.size;
    }
  } catch {
    // 容量管理失败不影响主链路
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HEIC 治理：历史 3MB+ iPhone 照片在 Windows Chrome/Edge 上的破图修复
// ─────────────────────────────────────────────────────────────────────────
// 数据库存量中存在早期未转码的 HEIC 照片，Windows Chrome/Edge/Firefox 原生
// 无法解码 HEIC → <img> 直接破图。下载端补救：
// 1. 魔数检测 Blob 是否为 HEIC/HEIF（ISO BMFF 容器，ftyp brand 白名单）；
// 2. 非 Safari 环境（Safari 原生支持 HEIC）→ heic2any 本地转 JPEG（动态加载，
//    仅命中 HEIC 时才下载 wasm，普通图片零开销）；
// 3. 转码后的 JPEG 回写 IndexedDB —— 每台设备仅首次下载+转码一次，
//    之后永久本地零流量秒开。

/** HEIC/HEIF 容器 brand 白名单（ftyp box 第 8~12 字节） */
const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1",
]);

/** 魔数检测：Blob 是否为 HEIC/HEIF */
async function isHeicBlob(blob: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (head.length < 12) return false;
    const brand = String.fromCharCode(...head.slice(8, 12)).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return true;
    // 兜底：未知新 brand 但结构为 ISO BMFF（00 00 00 xx 'ftyp'）且非 mp4 常规
    const ftyp = String.fromCharCode(...head.slice(4, 8));
    return (
      head[0] === 0 && head[1] === 0 && head[2] === 0 && ftyp === "ftyp" &&
      brand !== "isom" && brand !== "mp42" && brand !== "mp41"
    );
  } catch {
    return false;
  }
}

/** 仅 Safari（iOS/macOS）原生支持 HEIC 解码；Windows Chrome/Edge/Firefox 不支持 */
function browserSupportsHeicNatively(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua) && !/Chrom|Edg|OPR|Firefox|FxiOS|CriOS/i.test(ua);
}

/**
 * 确保浏览器可解码：HEIC Blob 在不支持原生解码的环境本地转 JPEG。
 * 转码失败静默返回原 Blob（Safari 正常；不支持端由 <img> onError 占位兜底）。
 */
async function ensureBrowserDecodable(blob: Blob): Promise<Blob> {
  if (!blob || blob.size === 0 || typeof window === "undefined") return blob;
  if (!(await isHeicBlob(blob))) return blob;
  if (browserSupportsHeicNatively()) return blob;
  try {
    console.info(
      `[image-cache] HEIC blob (${(blob.size / 1024).toFixed(0)}KB) → 本地转码 JPEG`,
    );
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
    const jpeg = Array.isArray(out) ? out[0] : out;
    if (jpeg && jpeg.size > 0) return jpeg;
  } catch (err) {
    console.warn("[image-cache] HEIC 本地转码失败:", err);
  }
  return blob;
}

// ─────────────────────────────────────────────────────────────────────────
// 内存 ObjectURL 池（引用计数 + LRU）
// ─────────────────────────────────────────────────────────────────────────

interface PoolEntry {
  key: string;
  objectUrl: string;
  /** 正在展示该图的组件数；0 = 可安全 revoke */
  refs: number;
  ts: number;
}

const pool = new Map<string, PoolEntry>();
const inflight = new Map<string, Promise<string>>();

function evictPoolIfNeeded(): void {
  if (pool.size <= MEMORY_POOL_MAX) return;
  const evictable = [...pool.values()]
    .filter((e) => e.refs <= 0)
    .sort((a, b) => a.ts - b.ts);
  for (const e of evictable) {
    if (pool.size <= MEMORY_POOL_MAX) break;
    pool.delete(e.key);
    try {
      URL.revokeObjectURL(e.objectUrl);
    } catch {
      // ignore
    }
  }
}

/** 同步探测内存池（已加载过的图可零延迟渲染，避免闪烁） */
export function peekImageUrl(ref: StorageRef): string | null {
  return pool.get(`${ref.bucket}/${ref.path}`)?.objectUrl ?? null;
}

/**
 * 同步 pin：命中内存池则引用计数 +1 并返回 ObjectURL（配对 releaseImageUrl）；
 * 未命中返回 null。Hook 渲染前锁定引用，防止并发 LRU 回收 revoke 掉正在显示的 URL。
 */
export function pinImageUrl(ref: StorageRef): string | null {
  const e = pool.get(`${ref.bucket}/${ref.path}`);
  if (e) {
    e.ts = Date.now();
    e.refs++;
    return e.objectUrl;
  }
  return null;
}

/**
 * 降级通道：经短效签名 URL（10 分钟）取回图片 Blob。
 * download() 因历史路径/RLS 差异失败（400/403/404）时的第二尝试 ——
 * 签名 URL 走同一套 RLS 校验，若仍失败则确认该文件对当前用户不可见。
 */
async function downloadViaSignedUrl(bucket: string, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 10);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "createSignedUrl failed");
  }
  const res = await fetch(data.signedUrl);
  if (!res.ok) {
    throw new Error(`Signed URL fetch failed: HTTP ${res.status}`);
  }
  return res.blob();
}

/**
 * 获取私密图片的本地 ObjectURL。
 * 命中顺序：内存池 → IndexedDB → Supabase download()（经 RLS 鉴权）→
 * 签名 URL 降级取回。
 *
 * @param pin true（默认）：组件正在使用，引用计数 +1，配对 releaseImageUrl 归还；
 *            false：一次性用途（如 Canvas 导出），不持有引用，可被 LRU 回收。
 */
export async function acquireImageUrl(ref: StorageRef, pin = true): Promise<string> {
  const key = `${ref.bucket}/${ref.path}`;
  const hit = pool.get(key);
  if (hit) {
    hit.ts = Date.now();
    if (pin) hit.refs++;
    return hit.objectUrl;
  }
  const running = inflight.get(key);
  if (running) {
    const url = await running;
    const e = pool.get(key);
    if (e) {
      if (pin) e.refs++;
      return url;
    }
    // 等待期间条目被 LRU 淘汰（引用计数尚未建立）→ 重新获取
    return acquireImageUrl(ref, pin);
  }
  const task = (async () => {
    // 1) IndexedDB 持久缓存命中 → 0 网络请求。
    //    损坏/空 Blob 一律视为未命中并立即删除（防缓存投毒：历史失败时期
    //    可能存入 0 字节或错误页 Blob，命中后会永久展示裂图）。
    let blob: Blob | undefined;
    try {
      const rec = await idbGet(key);
      if (rec?.blob && rec.blob.size > 0) {
        blob = rec.blob;
      } else {
        idbDelete(key).catch(() => {});
      }
    } catch {
      // IndexedDB 不可用（隐私模式等）→ 直接走网络
    }
    // 历史缓存中的 HEIC 原始 Blob（转码功能上线前入库）→ 本地转码后回写
    if (blob) {
      const decoded = await ensureBrowserDecodable(blob);
      if (decoded !== blob) {
        blob = decoded;
        idbPut(key, { blob, size: blob.size, ts: Date.now() })
          .then(() => idbTrim())
          .catch(() => {});
      }
    }
    // 2) Supabase 鉴权下载（RLS：仅行程成员可读），随后异步入库。
    //    下载失败（历史路径/两段式路径等 400/403/404）绝不直接破图：
    //    控制台记录失败路径 → 自动降级走短效签名 URL 二次取回。
    //    下载结果为空 Blob 时严禁入库（防缓存投毒），直接抛错走降级。
    //    历史存量 HEIC 照片（3MB+ 老图）→ 非 Safari 环境本地转码 JPEG 后入库：
    //    每台设备仅首次下载+转码一次，之后永久 IndexedDB 零流量秒开。
    if (!blob) {
      try {
        const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
        if (error || !data) throw new Error(error?.message || "Private image download failed");
        if (data.size === 0) throw new Error("Downloaded blob is empty (corrupted object?)");
        blob = await ensureBrowserDecodable(data);
      } catch (dlErr) {
        console.warn(
          `[image-cache] download failed (${ref.bucket}/${ref.path}), retrying via signed URL:`,
          dlErr instanceof Error ? dlErr.message : dlErr,
        );
        const fb = await downloadViaSignedUrl(ref.bucket, ref.path);
        if (fb.size === 0) throw new Error("Signed-URL blob is empty (corrupted object?)");
        blob = await ensureBrowserDecodable(fb);
      }
      idbPut(key, { blob, size: blob.size, ts: Date.now() })
        .then(() => idbTrim())
        .catch(() => {});
    }
    const objectUrl = URL.createObjectURL(blob);
    pool.set(key, { key, objectUrl, refs: 0, ts: Date.now() });
    return objectUrl;
  })();
  inflight.set(key, task);
  try {
    const url = await task;
    const e = pool.get(key);
    if (e) {
      if (pin) e.refs++;
      evictPoolIfNeeded();
      return url;
    }
    // 下载完成与 pin 之间被淘汰（极小概率）→ 重新获取
    return acquireImageUrl(ref, pin);
  } finally {
    inflight.delete(key);
  }
}

/** 归还引用（与 acquireImageUrl(ref, true) 配对；引用归零后可被 LRU 回收） */
export function releaseImageUrl(ref: StorageRef): void {
  const e = pool.get(`${ref.bucket}/${ref.path}`);
  if (e && e.refs > 0) e.refs--;
  evictPoolIfNeeded();
}

/**
 * 失效单张缓存：同路径覆盖上传（如 avatars 桶 `{uid}/avatar.jpg` upsert）
 * 后必须调用，否则本地会一直展示旧图。
 */
export function invalidateImage(bucket: string, path: string): void {
  const key = `${bucket}/${path}`;
  const e = pool.get(key);
  if (e) {
    pool.delete(key);
    try {
      URL.revokeObjectURL(e.objectUrl);
    } catch {
      // ignore
    }
  }
  inflight.delete(key);
  idbDelete(key).catch(() => {});
}

/** 清空全部私密图缓存（IndexedDB + 内存池） */
export async function clearImageCache(): Promise<void> {
  for (const e of pool.values()) {
    try {
      URL.revokeObjectURL(e.objectUrl);
    } catch {
      // ignore
    }
  }
  pool.clear();
  inflight.clear();
  try {
    (await openDb()).close();
  } catch {
    // ignore
  }
  dbPromise = null;
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // ignore
  }
}

/**
 * 一次性解析（非 React 场景，如 Canvas 邮票导出）：
 * 返回可直接用于 <img>/Image 的 URL —— 私密图为本地 ObjectURL，其余原样透传。
 */
export async function resolveImageForCanvas(
  value: string | null | undefined,
  bucket = "checkin-images",
): Promise<string> {
  if (!value) return "";
  const ref = parseStorageRef(value, bucket);
  if (!ref) return value;
  try {
    return await acquireImageUrl(ref, false);
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// React Hook
// ─────────────────────────────────────────────────────────────────────────

/**
 * 统一图片解析 Hook（按桶自动分流）：任意格式值 → 可渲染 URL（string | null）。
 *
 * - 公开桶引用（encyclopedia，含完整公开 URL 与相对路径）→ 同步返回公开直链，
 *   由调用方按需套 getOptimizedImageUrl / getHighResImageUrl 走 wsrv.nl CDN。
 * - 私密桶引用（checkin-images / avatars）→ 异步走 IndexedDB 缓存链路
 *   （加载中返回 null，渲染层显示骨架屏）；成功返回本地 ObjectURL，卸载自动归还。
 * - data:/blob:/外部 http(s) → 同步透传原值。
 */
export function usePrivateImage(
  value: string | null | undefined,
  bucket = "checkin-images",
): string | null {
  const ref = useMemo(() => parseStorageRef(value, bucket), [value, bucket]);

  // 公开桶：同步构造公开直链（与 ref 同生命周期，无异步状态）
  const publicUrl = useMemo(() => {
    if (!ref || !isPublicBucket(ref.bucket)) return null;
    return supabase.storage.from(ref.bucket).getPublicUrl(ref.path).data.publicUrl;
  }, [ref]);

  // 私密桶：走本地缓存链路
  const privateRef = ref && !publicUrl ? ref : null;

  // 初始值：内存池已缓存的图同步命中（SPA 内返回页面零闪烁）；
  // SSR/首帧返回 null → 渲染层显示骨架屏，且与 SSR HTML 一致避免 hydration 抖动
  const [url, setUrl] = useState<string | null>(() =>
    privateRef ? peekImageUrl(privateRef) : (publicUrl ?? value ?? null),
  );

  useEffect(() => {
    if (!privateRef) {
      setUrl(publicUrl ?? value ?? null);
      return;
    }
    const pinned = pinImageUrl(privateRef);
    if (pinned) {
      setUrl(pinned);
      return () => releaseImageUrl(privateRef);
    }
    let active = true;
    setUrl(null);
    acquireImageUrl(privateRef)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch((err) => {
        if (!active) return;
        // 两级降级均失败 → 终极兜底：绝不返回 null（渲染层出现裂图/空骨架）。
        // 原始值本身是 http(s) 完整 URL → 直接透传给 <img> 再试一次；
        // 否则构造公开直链。若仍加载失败，由组件 onError 切换占位（不破图）。
        console.error(
          `[image-cache] image unavailable, falling back to raw URL: ${privateRef.bucket}/${privateRef.path}`,
          err instanceof Error ? err.message : err,
        );
        if (value && /^https?:\/\//i.test(value)) {
          setUrl(value);
        } else {
          setUrl(
            supabase.storage.from(privateRef.bucket).getPublicUrl(privateRef.path).data.publicUrl,
          );
        }
      });
    return () => {
      active = false;
      releaseImageUrl(privateRef);
    };
  }, [privateRef, publicUrl, value]);

  return url;
}
