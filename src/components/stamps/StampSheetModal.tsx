import { useEffect, useRef, useState } from "react";
import { X, Moon, ScrollText, Download, Share2, Loader2, Shuffle } from "lucide-react";
import { useI18n } from "@/i18n";
import { resolveImageForCanvas } from "@/lib/image-cache";
import { getLocalizedLocationName } from "@/utils/location";
import type { StampEntry } from "./types";
import { aspectFor, type StampAspect } from "./PostageStamp";

/**
 * 【精选邮票明信片】导出预览弹窗。
 * - 前端 Canvas 拼图：6:4 横向比例，端侧自适应安全分辨率 ——
 *   移动端 3000 × 2000 (4K 级清晰度，绝不触发 iOS WebKit 内存熔断) / 电脑端 6000 × 4000；
 *   所有绘图参数基于 1800 设计稿按 SCALE = CANVAS_W / 1800 等比自适应
 * - 瀑布流排版：与展示墙 (CSS columns masonry) 完全一致的列高度算法 ——
 *   逐张放入当前最矮列，邮票保持 aspectFor(id) 的自然比例 (3:4 / 4:3 / 1:1)，绝不拉伸变形；
 *   列数与邮票宽度联合求解 (高度受限反解 / 宽度封顶)，整体在内容区居中，自然高低错落、严谨紧凑
 * - 深色经典 (#0B132B 暗调网格 + 白边锯齿邮票) / 浅色宣纸 (#F6F2EB 纸张噪点 + 满幅照片邮票)
 * - 秒级生成：Promise.all 并发拉取 600px WebP 轻量缩略图 (质量 85，严禁 5MB+ 原图)；
 *   LanternMing 字体全局仅预热一次，缓存命中后重排/换肤零重复阻塞
 * - 标题统一上元明朝体 (LanternMing)：绘制前 FontFaceSet.load 强制等待就绪，手机/电脑呈现一致
 * - 实体装裱层次：香槟金金属外框 ➔ 象牙白卡纸留白 (MAT_PADDING 四边严格等距) ➔ 画芯边缘内沉阴影；
 *   标题 + 邮票群作为整体在画芯内垂直居中，白卡纸留白上下左右均匀规整
 * - 底部零装饰：仅纯净留白边距，与顶部标题呼应
 * - 保存图片 (浏览器下载) + 系统原生分享 (Web Share API, 不支持时降级下载)
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** 参与排版的邮票 (调用方已按 精选优先 / 无星标取全量 策略筛选) */
  stamps: StampEntry[];
  tripName: string;
}

type SheetTheme = "dark" | "light";

// ─────────────────────────────────────────────
// 画布规格：端侧自适应安全分辨率 (防移动端 WebKit 内存上限熔断闪退)
// ─────────────────────────────────────────────
const DESIGN_W = 1800;
const MAX_COLS = 12;

let CANVAS_W = 6000;
let CANVAS_H = 4000;
let SCALE = CANVAS_W / DESIGN_W;
/** 香槟金金属外框宽度 (画布宽 2.2%) */
let FRAME_W = 132;
/** 卡纸内边距：上下左右严格共用同一数值 (画布宽 4.5%)，画芯在卡纸内绝对居中 */
let MAT_PADDING = 270;
/** 画芯内缩 = 外框 + 卡纸 */
let MARGIN_X = FRAME_W + MAT_PADDING;
/** 画芯内内容四周统一内边距 (标题/邮票与画芯边缘的呼吸距离) */
let CORE_PAD = 147;
/** 标题块高度 (含行高与下间隙) —— 标题 + 邮票群作为整体在画芯内垂直居中 */
let HEADER_H = 333;
/** 标题块与邮票群之间的间隙 */
let HEADER_GAP = 80;
/** 瀑布流可用宽度 = 画芯宽 - 两侧 CORE_PAD */
let CONTENT_W = CANVAS_W - (MARGIN_X + CORE_PAD) * 2;
let MASON_GAP = 18 * SCALE; // 邮票密集咬合，呈现精美集邮册质感
/**
 * 每次渲染前按设备重新求解安全分辨率与全部派生尺寸 (幂等)：
 * - 移动端 (iPhone/iPad/iPod/Android 或窄屏)：3000 × 2000，6MP 远低于 iOS 单画布上限
 * - 电脑端：6000 × 4000，保持超清细腻
 * 标题字号、边距、瀑布流间距等均按 SCALE = CANVAS_W / 1800 等比缩放
 */
function applyDeviceScale() {
  const isMobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
  CANVAS_W = isMobile ? 3000 : 6000;
  CANVAS_H = isMobile ? 2000 : 4000;
  SCALE = CANVAS_W / DESIGN_W;
  FRAME_W = Math.round(CANVAS_W * 0.022);
  MAT_PADDING = Math.round(CANVAS_W * 0.045);
  MARGIN_X = FRAME_W + MAT_PADDING;
  CORE_PAD = Math.round(44 * SCALE);
  HEADER_H = Math.round(100 * SCALE);
  HEADER_GAP = Math.round(24 * SCALE);
  CONTENT_W = CANVAS_W - (MARGIN_X + CORE_PAD) * 2;
  MASON_GAP = 18 * SCALE;
}

const SERIF = `Georgia, "Times New Roman", "Songti SC", "SimSun", serif`;
/** 上元明朝体 — 明信片标题专用 (public/fonts/LanternMingA/B.ttf，styles.css 注册 @font-face) */
const MING = `"LanternMing", serif`;

/**
 * LanternMing 字体预热 (全局仅加载一次)：canvas fillText 不会自行触发字体下载，
 * 必须 FontFaceSet.load() 显式加载并等待就绪，否则手机/电脑随机降级宋体/黑体。
 * TTF 下载一次即常驻 HTTP 缓存 —— 主题切换 / 随机重排 / 重开弹窗全部命中缓存，零重复阻塞。
 */
let mingWarmPromise: Promise<void> | null = null;
function warmLanternMing(sample: string): Promise<void> {
  if (!mingWarmPromise) {
    mingWarmPromise = document.fonts
      .load(`bold 64px "LanternMing"`, sample)
      .then(() => undefined)
      .catch(() => undefined);
  }
  return mingWarmPromise;
}

const SANS = `"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

const THEME: Record<
  SheetTheme,
  {
    bg: string;
    grid: string;
    title: string;
    secondary: string;
    hairline: string;
    seal: string;
    stampShadow: string;
    placeholder: string;
  }
> = {
  dark: {
    bg: "#0B132B",
    grid: "rgba(148,163,184,0.08)",
    title: "#E9EEF7",
    secondary: "rgba(233,238,247,0.52)",
    hairline: "rgba(233,238,247,0.22)",
    seal: "#5EEAD4",
    stampShadow: "rgba(0,0,0,0.55)",
    placeholder: "#1C2A4A",
  },
  light: {
    bg: "#F6F2EB",
    grid: "rgba(70,63,53,0.05)",
    title: "#463F35",
    secondary: "rgba(70,63,53,0.62)",
    hairline: "rgba(70,63,53,0.30)",
    seal: "#B3402F",
    stampShadow: "rgba(88,72,44,0.30)",
    placeholder: "#E7E0D2",
  },
};

const CATEGORY_EMOJI: Record<string, string> = {
  cities: "🏛️",
  nature: "🍃",
  food: "🍲",
};

// 展示墙同款自然比例：portrait 3:4 / landscape 4:3 / square 1:1 (统一以 w/h 表示)
const ASPECT_RATIO: Record<StampAspect, number> = {
  portrait: 3 / 4,
  landscape: 4 / 3,
  square: 1,
};

// ─────────────────────────────────────────────
// 基础工具
// ─────────────────────────────────────────────

/** 强制英文日期格式（与 PostageStamp 一致），示例：AUG 08, 2026 */
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

/** 可复现伪随机 (宣纸噪点用，保证同参数渲染结果一致) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 加载位图用于 Canvas 绘制。
 * http(s) 一律 crossOrigin=anonymous —— CORS 失败宁可降级为占位卡，
 * 也绝不以匿名模式重试污染画布导致 toBlob 抛 SecurityError。
 */
function loadRaster(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/png");
  });
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim() || "stamp-sheet";
}

// ─────────────────────────────────────────────
// 瀑布流 (Masonry) 排版算法 —— 与展示墙 CSS columns 行为一致
// ─────────────────────────────────────────────

type Placement = { x: number; y: number; w: number; h: number };

/**
 * 列高度瀑布流：
 * 1. 遍历候选列数 (1 ~ min(MAX_COLS, N))，每种列数下按「当前最矮列优先」贪心分配
 *    (列宽统一 → 分配结果与具体宽度无关，可用 1/ratio 累计高度做权重)；
 * 2. 由最紧的一列反解邮票宽度 w (w * Σ(1/ratio) + gaps ≤ availH)，
 *    并封顶于列宽上限 (CONTENT_W 均分)；取「w 最大」的列数方案，保证邮票尽可能大；
 * 3. 水平在内容区居中；垂直方向 y 从 0 起不定位，由调用方整体平移 ——
 *    「标题 + 邮票群」才能作为整体在画芯内严格垂直居中 (卡纸留白 Top === Bottom)。
 * 邮票保持自然比例，每张独立计高 —— 结果与展示墙一样高低错落、紧凑饱满。
 */
function planMasonry(
  ratios: number[],
  availH: number,
): { placements: Placement[]; blockH: number } {
  const n = ratios.length;
  if (n === 0) return { placements: [], blockH: 0 };

  let best: {
    w: number;
    cols: number;
    assign: number[];
    colUnits: number[];
    colCounts: number[];
  } | null = null;

  for (let cols = 1; cols <= Math.min(MAX_COLS, n); cols++) {
    const colUnits = new Array<number>(cols).fill(0);
    const colCounts = new Array<number>(cols).fill(0);
    const assign: number[] = [];
    for (const r of ratios) {
      // 始终放入当前高度最低的那一列
      let j = 0;
      for (let k = 1; k < cols; k++) {
        if (colUnits[k] < colUnits[j] - 1e-9) j = k;
      }
      assign.push(j);
      colUnits[j] += 1 / r;
      colCounts[j] += 1;
    }
    // 高度约束：每列 w * units + gap * (count-1) ≤ availH，取最紧一列反解 w
    let w = Infinity;
    for (let j = 0; j < cols; j++) {
      if (colUnits[j] <= 0) continue;
      const wj = (availH - MASON_GAP * (colCounts[j] - 1)) / colUnits[j];
      if (wj < w) w = wj;
    }
    // 宽度约束：N 列均分内容区宽度
    const maxW = (CONTENT_W - MASON_GAP * (cols - 1)) / cols;
    if (maxW < w) w = maxW;
    if (!isFinite(w) || w <= 0) continue;
    if (!best || w > best.w) best = { w, cols, assign, colUnits, colCounts };
  }

  if (!best) return { placements: [], blockH: 0 };
  const { w, cols, assign, colUnits, colCounts } = best;

  const blockW = w * cols + MASON_GAP * (cols - 1);
  const startX = MARGIN_X + CORE_PAD + (CONTENT_W - blockW) / 2;
  let blockH = 0;
  for (let j = 0; j < cols; j++) {
    blockH = Math.max(blockH, w * colUnits[j] + MASON_GAP * (colCounts[j] - 1));
  }

  const cursor = new Array<number>(cols).fill(0);
  const placements = ratios.map((r, i) => {
    const j = assign[i];
    const h = w / r;
    const p: Placement = { x: startX + j * (w + MASON_GAP), y: cursor[j], w, h };
    cursor[j] += h + MASON_GAP;
    return p;
  });
  return { placements, blockH };
}

// ─────────────────────────────────────────────
// Canvas 绘制原语
// ─────────────────────────────────────────────

/** object-fit: cover 等价绘制 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ir = img.width / img.height;
  const cr = w / h;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > cr) {
    sh = img.height;
    sw = sh * cr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / cr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** 邮票锯齿边：沿四边打半圆孔 (与 CSS radial-gradient mask 等价) */
function punchPerforation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  for (let cx = x + g / 2; cx < x + w; cx += g) {
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, y + h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let cy = y + g / 2; cy < y + h; cy += g) {
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 深色模式：暗调网格线 */
function drawGrid(ctx: CanvasRenderingContext2D, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = SCALE;
  const step = 90 * SCALE;
  for (let x = step; x < CANVAS_W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, CANVAS_H);
    ctx.stroke();
  }
  for (let y = step; y < CANVAS_H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(CANVAS_W, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** 浅色模式：微弱纸张噪点 (固定种子，预览与导出完全一致；数量随画布面积等比放大) */
function drawPaperNoise(ctx: CanvasRenderingContext2D) {
  const rand = mulberry32(20260930);
  const count = Math.round(2600 * SCALE * SCALE);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rand() * CANVAS_W;
    const y = rand() * CANVAS_H;
    const a = 0.015 + rand() * 0.035;
    ctx.fillStyle =
      rand() < 0.75 ? `rgba(88,72,44,${a.toFixed(3)})` : `rgba(255,255,255,${(a + 0.02).toFixed(3)})`;
    const s = rand() < 0.85 ? 1.5 * SCALE : 2.5 * SCALE;
    ctx.fillRect(x, y, s, 1.5 * SCALE);
  }
  ctx.restore();
}

/**
 * 实体装裱画框 (Frame & Mat)：
 * 1) 最外层：哑光香槟金金属外框 (画布宽 2.2%，对角微渐变 + 双深色压线勾勒框体轮廓)；
 * 2) 中间层：博物馆级象牙白卡纸留白 (画布宽 4.5%)，外缘带框体接触暗线。
 */
function drawFrameMat(ctx: CanvasRenderingContext2D) {
  // 1. 金色外框：对角低对比渐变模拟金属哑光漫反射
  const gold = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  gold.addColorStop(0, "#D2B98F");
  gold.addColorStop(0.5, "#C5A880");
  gold.addColorStop(1, "#B7976C");
  ctx.fillStyle = gold;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 外框最外缘 + 内缘深色压线 (金属框体轮廓)
  const lw = Math.max(2, 2 * SCALE);
  ctx.strokeStyle = "rgba(113,90,58,0.55)";
  ctx.lineWidth = lw;
  ctx.strokeRect(lw / 2, lw / 2, CANVAS_W - lw, CANVAS_H - lw);
  ctx.strokeRect(
    FRAME_W - lw / 2,
    FRAME_W - lw / 2,
    CANVAS_W - FRAME_W * 2 + lw,
    CANVAS_H - FRAME_W * 2 + lw,
  );

  // 2. 象牙白卡纸 (Passepartout)
  ctx.fillStyle = "#FBFBFA";
  ctx.fillRect(FRAME_W, FRAME_W, CANVAS_W - FRAME_W * 2, CANVAS_H - FRAME_W * 2);
  // 框体压在卡纸上的接触暗线 (卡纸外缘一圈发丝线)
  const hl = Math.max(1, SCALE);
  ctx.strokeStyle = "rgba(113,90,58,0.22)";
  ctx.lineWidth = hl;
  ctx.strokeRect(
    FRAME_W + hl / 2,
    FRAME_W + hl / 2,
    CANVAS_W - FRAME_W * 2 - hl,
    CANVAS_H - FRAME_W * 2 - hl,
  );
}

/**
 * 画芯边缘微下沉阴影：卡纸开口与画芯背景的交界处一圈极细微内阴影 (Inner Shadow / Bevel)，
 * 模拟画芯深陷卡纸内部的逼真立体感 —— 阴影落在画芯内侧、向内快速渐隐。
 */
function drawCoreBevel(ctx: CanvasRenderingContext2D, theme: SheetTheme) {
  const x = MARGIN_X;
  const y = MARGIN_X;
  const w = CANVAS_W - MARGIN_X * 2;
  const h = CANVAS_H - MARGIN_X * 2;
  // 深色画芯需更重阴影才可感知；浅色宣纸保持极其细微
  const a = theme === "dark" ? 0.34 : 0.16;
  const s = CANVAS_W * 0.012; // 阴影向内衰减距离 (画布宽 1.2%)

  // 卡纸切口发丝暗线
  const hl = Math.max(1, SCALE);
  ctx.strokeStyle = `rgba(60,50,35,${theme === "dark" ? 0.28 : 0.18})`;
  ctx.lineWidth = hl;
  ctx.strokeRect(x + hl / 2, y + hl / 2, w - hl, h - hl);

  // 四边内向渐隐阴影 (顶边最重 — 模拟上方光源)
  let g = ctx.createLinearGradient(0, y, 0, y + s);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, s);

  g = ctx.createLinearGradient(0, y + h, 0, y + h - s);
  g.addColorStop(0, `rgba(0,0,0,${a * 0.7})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h - s, w, s);

  g = ctx.createLinearGradient(x, 0, x + s, 0);
  g.addColorStop(0, `rgba(0,0,0,${a * 0.8})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, h);

  g = ctx.createLinearGradient(x + w, 0, x + w - s, 0);
  g.addColorStop(0, `rgba(0,0,0,${a * 0.8})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x + w - s, y, s, h);
}

/** 顶部装饰：上元明朝体旅行名称 (加粗居中、字号加大、无任何横线，极简高级) */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  tripName: string,
  T: (typeof THEME)["dark"],
  titleY: number,
) {
  const name = (tripName || "").trim();
  // 无行程名称时保持纯净留白 (无基线装饰)
  if (!name) return;

  let size = 56 * SCALE;
  const maxW = CONTENT_W - 96 * SCALE;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${7 * SCALE}px`;
  } catch {
    /* 不支持 letter-spacing 的浏览器静默忽略 */
  }
  ctx.font = `700 ${size}px ${MING}`;
  while (ctx.measureText(name).width > maxW && size > 22 * SCALE) {
    size -= 2 * SCALE;
    ctx.font = `700 ${size}px ${MING}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = T.title;
  ctx.fillText(name, CANVAS_W / 2, titleY);
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  } catch {
    /* noop */
  }
}

/** 单张邮票：按瀑布流 Placement 的自然比例绘制 (照片/占位 + 渐变 + 徽章 + 城市/日期) → 打锯齿孔 → 带投影贴入主画布 */
function drawStamp(
  ctx: CanvasRenderingContext2D,
  entry: StampEntry,
  img: HTMLImageElement | null,
  p: Placement,
  theme: SheetTheme,
  T: (typeof THEME)["dark"],
) {
  const isDark = theme === "dark";
  const w = p.w;
  const h = p.h;

  const off = document.createElement("canvas");
  off.width = Math.ceil(w);
  off.height = Math.ceil(h);
  const octx = off.getContext("2d");
  if (!octx) return;

  const base = Math.min(w, h);
  const perfR = Math.max(4 * SCALE, base * 0.024);
  const perfG = Math.max(12 * SCALE, base * 0.072);
  const borderPad = isDark ? Math.max(8 * SCALE, base * 0.042) : 0;

  // 深色模式：白色衬边凸显邮票物理质感；浅色模式：照片满幅
  if (isDark) {
    octx.fillStyle = "#FFFFFF";
    octx.fillRect(0, 0, w, h);
  }

  const px = borderPad;
  const py = borderPad;
  const pw = w - borderPad * 2;
  const ph = h - borderPad * 2;

  if (img) {
    drawCover(octx, img, px, py, pw, ph);
  } else {
    octx.fillStyle = T.placeholder;
    octx.fillRect(px, py, pw, ph);
  }

  // 上下渐变遮罩：保证白字可读 (与 PostageStamp 视觉一致)
  const grad = octx.createLinearGradient(0, py + ph * 0.45, 0, py + ph);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.80)");
  octx.fillStyle = grad;
  octx.fillRect(px, py, pw, ph);
  const topGrad = octx.createLinearGradient(0, py, 0, py + ph * 0.25);
  topGrad.addColorStop(0, "rgba(0,0,0,0.32)");
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  octx.fillStyle = topGrad;
  octx.fillRect(px, py, pw, ph);

  // 右上角：圆形分类徽章
  const emoji = CATEGORY_EMOJI[entry.category] || "🏛️";
  const badgeR = Math.max(10 * SCALE, base * 0.055);
  const bx = px + pw - badgeR - base * 0.045;
  const by = py + badgeR + base * 0.045;
  octx.beginPath();
  octx.arc(bx, by, badgeR, 0, Math.PI * 2);
  octx.fillStyle = "rgba(15,23,42,0.35)";
  octx.fill();
  octx.lineWidth = Math.max(1, badgeR * 0.09);
  octx.strokeStyle = "rgba(255,255,255,0.75)";
  octx.stroke();
  octx.font = `${Math.round(badgeR * 1.15)}px ${EMOJI_FONT}`;
  octx.textAlign = "center";
  octx.textBaseline = "middle";
  octx.fillText(emoji, bx, by + badgeR * 0.06);

  // 底部：城市名 (强制英文大写) + 日期 (强制英文格式)
  const title = getLocalizedLocationName(
    entry.city || entry.location || entry.title || "",
    "en",
  ).toUpperCase();
  const tSize = Math.max(11 * SCALE, Math.min(base * 0.082, 40 * SCALE));
  const dSize = Math.max(8 * SCALE, tSize * 0.52);
  const inset = base * 0.05;
  const tx = px + inset;
  const dateBaseline = py + ph - inset;
  const titleBaseline = dateBaseline - dSize * 1.35;
  octx.textAlign = "left";
  octx.textBaseline = "alphabetic";
  octx.shadowColor = "rgba(0,0,0,0.85)";
  octx.shadowBlur = tSize * 0.35;
  octx.fillStyle = "#FFFFFF";
  octx.font = `700 ${tSize}px ${SERIF}`;
  let t = title;
  const maxTW = pw - inset * 2;
  while (octx.measureText(t).width > maxTW && t.length > 3) t = t.slice(0, -2);
  if (t !== title && t.length > 1) t += "…";
  octx.fillText(t, tx, titleBaseline);
  octx.font = `600 ${dSize}px ${SANS}`;
  octx.fillText(formatStampDateEN(entry.createdAt), tx, dateBaseline);
  octx.shadowBlur = 0;

  // 锯齿边冲孔
  punchPerforation(octx, 0, 0, w, h, perfR, perfG);

  // 暗部投影 + 贴入主画布 (shadow 跟随冲孔后的 alpha 形状)
  ctx.save();
  ctx.shadowColor = T.stampShadow;
  ctx.shadowBlur = isDark ? base * 0.05 : base * 0.035;
  ctx.shadowOffsetY = isDark ? base * 0.028 : base * 0.018;
  ctx.drawImage(off, p.x, p.y);
  ctx.restore();
}

/** 主入口：按设备安全分辨率生成 6:4 明信片画布 */
function renderSheet(
  stamps: StampEntry[],
  images: (HTMLImageElement | null)[],
  tripName: string,
  theme: SheetTheme,
): HTMLCanvasElement {
  applyDeviceScale();
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const T = THEME[theme];

  // 1. 实体装裱：香槟金金属外框 ➔ 象牙白卡纸留白 (画芯四边等距，卡纸内绝对居中)
  drawFrameMat(ctx);

  // 2. 画芯背景：深色 → 暗调网格线；浅色 → 宣纸噪点 (限定在卡纸开口内)
  const coreX = MARGIN_X;
  const coreY = MARGIN_X;
  const coreW = CANVAS_W - MARGIN_X * 2;
  const coreH = CANVAS_H - MARGIN_X * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(coreX, coreY, coreW, coreH);
  ctx.clip();
  ctx.fillStyle = T.bg;
  ctx.fillRect(coreX, coreY, coreW, coreH);
  if (theme === "dark") drawGrid(ctx, T.grid);
  else drawPaperNoise(ctx);
  ctx.restore();

  // 3. 画芯边缘微下沉阴影 (画芯深陷卡纸的立体感)
  drawCoreBevel(ctx, theme);

  // 4. 标题 + 邮票群作为整体在画芯内垂直居中 ——
  //    白卡纸留白 Top === Bottom、Left === Right，四边严格等距、规整大气
  const hasName = !!(tripName || "").trim();
  const headerH = hasName ? HEADER_H : 0;
  const headerGap = hasName ? HEADER_GAP : 0;
  const innerTop = coreY + CORE_PAD;
  const innerH = coreH - CORE_PAD * 2;
  const ratios = stamps.map((s) => ASPECT_RATIO[aspectFor(s.id)] ?? 1);
  const { placements, blockH } = planMasonry(ratios, innerH - headerH - headerGap);
  const slack = Math.max(0, (innerH - headerH - headerGap - blockH) / 2);
  const offsetY = innerTop + slack + headerH + headerGap;

  if (hasName) {
    drawHeader(ctx, tripName, T, innerTop + slack + headerH / 2);
  }

  // 5. 瀑布流铺邮票 (自然比例，绝不拉伸变形)
  stamps.forEach((s, i) => {
    const p = placements[i];
    if (!p) return;
    drawStamp(ctx, s, images[i] ?? null, { ...p, y: p.y + offsetY }, theme, T);
  });

  return canvas;
}

// ─────────────────────────────────────────────
// 弹窗组件
// ─────────────────────────────────────────────

export function StampSheetModal({ open, onClose, stamps, tripName }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [theme, setTheme] = useState<SheetTheme>("dark");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  // 当前设备实际导出规格 (用于界面元信息展示)
  const [spec, setSpec] = useState({ w: 6000, h: 4000 });
  // 随机重排后的邮票顺序 (null = 原始顺序)
  const [shuffled, setShuffled] = useState<StampEntry[] | null>(null);
  const orderedStamps = shuffled ?? stamps;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const setPreview = (url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPreviewUrl(url);
  };

  // 打开 / 切换主题时重新生成 (字体就绪 + 图片并行加载 → 离屏渲染 → Blob 预览)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRendering(true);
    // 先按设备求解安全分辨率，拉图宽度等参数随之确定
    applyDeviceScale();
    (async () => {
      try {
        // 图片并发拉取 + 字体预热并行 (Promise.all 全并发，无逐张串行阻塞) ——
        // 二者互不等待，总耗时只取决于最慢一路
        const imgsPromise = Promise.all(
          orderedStamps.map((s) =>
            // 私密桶图片经本地 IndexedDB 缓存链路解析为 ObjectURL 后绘制：
            // 缓存命中 0 网络请求（重复导出秒级完成）；经 RLS 鉴权下载，
            // 绝不经过 wsrv.nl 等第三方 CDN（防泄密）。图片上传时已客户端压缩，
            // 原图体积可控；ObjectURL 同源，Canvas 不会被污染。
            resolveImageForCanvas(s.photo).then(loadRaster),
          ),
        );
        // 上元明朝体预热 (全局仅一次)：canvas fillText 不会自行触发字体下载，
        // 必须 FontFaceSet.load() 显式等待就绪；缓存命中后重排/换肤零重复阻塞。
        // 首次下载 TTF 较大 (A ≈ 29MB)：10s 超时兜底防弱网无限等待
        await Promise.race([
          warmLanternMing(tripName || "旅"),
          new Promise((res) => setTimeout(res, 10000)),
        ]);
        const imgs = await imgsPromise;
        if (cancelled) return;
        const canvas = renderSheet(orderedStamps, imgs, tripName, theme);
        canvasRef.current = canvas;
        setSpec({ w: canvas.width, h: canvas.height });
        // 及时清理临时图片缓存：释放已解码位图引用，降低 PNG 编码期峰值内存
        imgs.length = 0;
        canvas.toBlob((blob) => {
          if (cancelled) return;
          if (!blob) {
            setRendering(false);
            return;
          }
          setPreview(URL.createObjectURL(blob));
          setRendering(false);
        }, "image/png");
      } catch {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, theme, orderedStamps, tripName]);

  // 关闭弹窗时重置随机顺序，下次打开回到原始排序
  useEffect(() => {
    if (!open) setShuffled(null);
  }, [open]);

  // 卸载时释放预览 ObjectURL
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  // 随机重排：打乱邮票顺序并立即重新渲染 Canvas，可不断点击切换不同错落组合
  const handleShuffle = () => {
    setShuffled([...orderedStamps].sort(() => Math.random() - 0.5));
  };

  if (!open) return null;

  const fileName = safeFileName(`${tripName || "Trip"}_精选邮票集.png`);

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy("save");
    try {
      downloadBlob(await canvasToBlob(canvas));
    } catch {
      /* 导出失败静默 */
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy("share");
    try {
      const blob = await canvasToBlob(canvas);
      const imageFile = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [imageFile] })) {
        await nav.share({
          files: [imageFile],
          title: isEn ? "My Travel Stamps" : "我的旅行邮票集",
          text: isEn
            ? "A postcard of the stamps we collected on our journey!"
            : "这是我们在旅途中收集的精选邮票明信片！",
        });
      } else {
        // 不支持原生文件分享时降级为直接下载
        downloadBlob(blob);
      }
    } catch (err) {
      // 用户主动取消分享 (AbortError) 不做处理，其余降级下载
      if ((err as DOMException)?.name !== "AbortError") {
        try {
          downloadBlob(await canvasToBlob(canvas));
        } catch {
          /* noop */
        }
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[88vh] bg-card border border-border rounded-3xl p-5 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 + 关闭 */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-sm font-bold text-foreground">
            {isEn ? "Stamp Postcard" : "精选邮票明信片"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 深色经典 / 浅色宣纸 双色切换 + 右侧随机重排 */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <div className="flex-1 flex items-center justify-center gap-1 p-1 bg-muted rounded-full ring-1 ring-border">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                theme === "dark"
                  ? "bg-slate-900 text-white shadow-sm dark:bg-brand dark:text-slate-950"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              {isEn ? "Dark Classic" : "深色经典"}
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                theme === "light"
                  ? "bg-amber-100 text-amber-900 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" />
              {isEn ? "Light Paper" : "浅色宣纸"}
            </button>
          </div>
          {/* 随机重排：轻量半透明胶囊按钮 */}
          <button
            type="button"
            onClick={handleShuffle}
            title={isEn ? "Shuffle" : "随机排列"}
            aria-label={isEn ? "Shuffle" : "随机排列"}
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/70 ring-1 ring-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
          >
            <Shuffle className="h-4 w-4" />
          </button>
        </div>

        {/* 6:4 高保真缩略预览：CSS 自适应缩放 (aspect-[6/4]，手机端可直接长按保存)。
            禁用 rounded-* / overflow-hidden / border —— 金色画框四角必须原汁原味 90° 硬朗直角 */}
        <div className="relative w-full aspect-[6/4] bg-muted shrink-0">
          {previewUrl && (
            <img
              src={previewUrl}
              alt={isEn ? "Stamp postcard preview" : "邮票明信片预览"}
              className="max-w-full h-full w-full object-contain"
              draggable={false}
            />
          )}
          {rendering && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/80">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
              <p className="text-[11px] text-muted-foreground">
                {isEn ? "Composing postcard…" : "正在合成明信片…"}
              </p>
            </div>
          )}
        </div>

        {/* 元信息 */}
        <p className="mt-2.5 text-[11px] text-muted-foreground text-center shrink-0">
          {isEn
            ? `${orderedStamps.length} stamps · ${spec.w} × ${spec.h} (6:4)`
            : `共 ${orderedStamps.length} 张邮票 · ${spec.w} × ${spec.h} (6:4 超清)`}
          {" · "}
          {isEn ? "Long-press the preview to save on mobile" : "手机端可长按预览图保存"}
        </p>

        {/* 底部双动作：保存图片 / 分享 */}
        <div className="grid grid-cols-2 gap-2 mt-3 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={rendering || !!busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 dark:bg-brand dark:text-slate-950"
          >
            {busy === "save" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isEn ? "Save Image" : "保存图片"}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={rendering || !!busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 dark:bg-white dark:text-slate-950"
          >
            {busy === "share" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {isEn ? "Share" : "分享"}
          </button>
        </div>
      </div>
    </div>
  );
}
