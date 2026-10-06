/**
 * 一次性脚本：压缩 Supabase Storage 中已存在的大图。
 *
 * 用法：
 *   1. 在项目根目录创建 .env 文件，配置：
 *      SUPABASE_URL=https://xxxx.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY=eyJxxxx（service_role key，绕过 RLS）
 *   2. 运行：npm run compress-storage
 *
 * 逻辑：
 *   - 列出所有 Bucket 中的所有文件
 *   - 过滤出大于 500KB 的图片（jpg/png/webp/gif）
 *   - 逐个下载 → sharp 压缩（maxWidth 1280, webp quality 75）→ 覆盖上传
 *   - 上传时统一改名为 .webp 后缀
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ 缺少环境变量 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY\n" +
      "请在项目根目录 .env 文件中配置后重试。",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── 配置 ────────────────────────────────────────────────────
const MAX_WIDTH = 1280;
const QUALITY = 75;
const SIZE_THRESHOLD = 500 * 1024; // 500KB
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

// ─── 工具函数 ────────────────────────────────────────────────
function isImage(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function toWebpPath(path: string): string {
  return path.replace(/\.[^/.]+$/, "") + ".webp";
}

async function listAllFiles(
  bucket: string,
): Promise<{ name: string; id: string; metadata: { size?: number } }[]> {
  const all: { name: string; id: string; metadata: { size?: number } }[] = [];
  let offset = 0;
  const limit = 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list("", { limit, offset });

    if (error) {
      console.warn(`⚠️  列出 ${bucket} 失败:`, error.message);
      return all;
    }

    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }

  // 递归列出子文件夹中的文件
  // Supabase list 只列出顶层，需要递归处理带 / 的路径
  // 为简化，此处仅处理顶层文件（大多数项目图片在顶层或一级子目录）
  return all;
}

async function compressAndUpload(
  bucket: string,
  filePath: string,
  size: number,
): Promise<boolean> {
  console.log(
    `  ⏬ 下载 ${filePath} (${(size / 1024).toFixed(0)}KB)...`,
  );

  // 1. 下载
  const { data: fileData, error: dlErr } = await supabase.storage
    .from(bucket)
    .download(filePath);

  if (dlErr || !fileData) {
    console.error(`  ❌ 下载失败: ${dlErr?.message}`);
    return false;
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  // 2. sharp 压缩
  try {
    const compressed = await sharp(buffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();

    const newSize = compressed.length;
    const ratio = ((1 - newSize / size) * 100).toFixed(1);

    // 3. 上传（覆盖，改名为 .webp）
    const newPath = toWebpPath(filePath);
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(newPath, compressed, {
        contentType: "image/webp",
        cacheControl: "3600000",
        upsert: true,
      });

    if (upErr) {
      console.error(`  ❌ 上传失败: ${upErr.message}`);
      return false;
    }

    console.log(
      `  ✅ ${filePath} → ${newPath}: ${(size / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (-${ratio}%)`,
    );

    // 4. 删除旧文件（仅当新路径与旧路径不同时）
    if (newPath !== filePath) {
      const { error: delErr } = await supabase.storage
        .from(bucket)
        .remove([filePath]);
      if (delErr) {
        console.warn(`  ⚠️  旧文件删除失败（可手动删除）: ${delErr.message}`);
      } else {
        console.log(`  🗑️  已删除旧文件: ${filePath}`);
      }
    }

    return true;
  } catch (err: any) {
    console.error(`  ❌ sharp 处理失败: ${err?.message}`);
    return false;
  }
}

// ─── 主流程 ──────────────────────────────────────────────────
async function main() {
  console.log("🚀 Supabase Storage 大图压缩脚本\n");
  console.log(`配置: maxWidth=${MAX_WIDTH}px, quality=${QUALITY}, 阈值=${(SIZE_THRESHOLD / 1024).toFixed(0)}KB\n`);

  // 1. 列出所有 Bucket
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.error("❌ 列出 Bucket 失败:", bucketErr.message);
    process.exit(1);
  }

  if (!buckets || buckets.length === 0) {
    console.log("⚠️  没有找到任何 Bucket");
    return;
  }

  console.log(`📦 发现 ${buckets.length} 个 Bucket: ${buckets.map((b) => b.name).join(", ")}\n`);

  let totalProcessed = 0;
  let totalCompressed = 0;
  let totalSkipped = 0;

  // 2. 遍历每个 Bucket
  for (const bucket of buckets) {
    console.log(`\n📂 处理 Bucket: ${bucket.name}`);

    const files = await listAllFiles(bucket.name);
    console.log(`   共 ${files.length} 个文件`);

    for (const file of files) {
      totalProcessed++;
      const filePath = file.name;
      const size = file.metadata?.size ?? 0;

      // 跳过非图片
      if (!isImage(filePath)) {
        totalSkipped++;
        continue;
      }

      // 跳过小于阈值的图片
      if (size < SIZE_THRESHOLD) {
        console.log(`  ⏭️  跳过 ${filePath} (${(size / 1024).toFixed(0)}KB < 阈值)`);
        totalSkipped++;
        continue;
      }

      const ok = await compressAndUpload(bucket.name, filePath, size);
      if (ok) totalCompressed++;
    }
  }

  // 3. 汇总
  console.log("\n" + "═".repeat(60));
  console.log("📊 压缩完成汇总:");
  console.log(`   总处理文件数: ${totalProcessed}`);
  console.log(`   已压缩: ${totalCompressed}`);
  console.log(`   跳过（非图片/小文件）: ${totalSkipped}`);
  console.log("═".repeat(60));

  // 4. 提醒更新数据库中的图片路径
  console.log("\n⚠️  重要提醒:");
  console.log("   如果有文件从 .jpg/.png 改名为 .webp，");
  console.log("   请同步更新数据库中的 image_url / photo_url / avatar_url 字段，");
  console.log("   或在前端 getOptimizedImageUrl 中保留对旧路径的兼容。");
  console.log("   （wsrv.nl CDN 代理会自动处理格式转换，路径不变也能正常压缩）");
}

main().catch((err) => {
  console.error("💥 脚本异常退出:", err);
  process.exit(1);
});
