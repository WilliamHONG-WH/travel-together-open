import mammoth from "mammoth";

// ---------------------------------------------------------------------------
// 博物馆百科「导入文档自动填充」解析器
//
// 支持 .docx（mammoth convertToHtml：文本 + 内嵌图片转 data URI）/ .md / .txt。
//
// 【文本格式】标签行 + 章节结构，中英双语标签均可识别，兼容 Markdown 标题 /
// 列表 / 加粗装饰、中英文冒号、【】包裹符、全角空格；以 ※ 开头的行视为
// 模板格式说明注释，导入时无条件忽略：
//
//   # 卢浮宫 Musée du Louvre             <- 标题（# 标题 / 首行短文本 / 名称：标签）
//   【国家】：法国                        <- 标签行（国家：/country: 亦可）
//   城市：巴黎
//   详细地址：Rue de Rivoli, 75001 Paris
//   开放时间：周一至周日 09:00 – 18:00
//   简介：
//   原本是 12 世纪的皇家堡垒……            <- 后续段落自动累积为多行简介
//   ## 核心展品                           <- 展品章节（代表作品 / Highlights 等别名）
//   ### 蒙娜丽莎 Mona Lisa                <- 展品标题（展品1： / 1. / 【】 等形式；标题行
//                                            支持任意字符 —— 中英文/意法文/&/()/·//数字，
//                                            最长 150 字符；「作品简介：」锚点的上一行
//                                            100% 视为新展品标题 —— 前瞻回溯精准识别）
//   英文名：Mona Lisa
//   中文名：蒙娜丽莎
//   作品简介：达芬奇创作于 1503–1519 年……
//   历史故事：1911 年被盗……
//
// 【图片格式】
//   - .docx 内嵌图片：按位置自动路由 ——
//       简介/核心展品之前的图片     -> 封面 coverImage
//       展品描述区域的图片          -> 该展品的照片 exhibits[].image
//       【导览图】章节内的图片      -> attachments（导览图列表 guideImages）
//   - .md / .txt：支持图片链接行 ——
//       【封面图片】：https://...    （或 ![...](https://...) / 裸图片 URL 行）
//       【展品图片】：https://...
//       【导览图】：https://...
//       以及 Markdown 图片 / 裸 URL 图片行的位置路由（同 docx 规则）
// ---------------------------------------------------------------------------

/** 解析出的图片（.docx 内嵌为 data: URI；.md/.txt 链接为 http(s) URL） */
export interface ParsedImage {
  src: string;
}

export interface ParsedExhibitDraft {
  /** 展品英文名（对应 Exhibit.name） */
  name: string;
  /** 展品中文名（对应 Exhibit.nameCn） */
  nameCn: string;
  /** 作品简介（对应 Exhibit.background） */
  background: string;
  /** 历史故事（对应 Exhibit.story） */
  story: string;
  /** 展品照片（文档中该展品区域的内嵌图片或图片链接） */
  image?: ParsedImage;
}

export interface ParsedMuseumDoc {
  /** 名称/标题（外文名或原文标题；中文优先填充在表单层处理） */
  name?: string;
  /** 中文名 */
  nameCn?: string;
  country?: string;
  city?: string;
  address?: string;
  hours?: string;
  intro?: string;
  /** 隐形高精坐标（【坐标】/【经纬度】：41.8914, 12.4965 / GPS: ... 标签行）：
   *  仅供内部地图定位使用，UI 不展示 —— 命中后跳过网络地理编码 */
  latitude?: number;
  longitude?: number;
  /** 封面照片（文档顶部/【封面图片】区域的图片） */
  coverImage?: ParsedImage;
  /** 导览图列表（【导览图】章节的图片 + 多余位置图片的归档） */
  guideImages: ParsedImage[];
  exhibits: ParsedExhibitDraft[];
}

/** 文档块流：文本行 或 内嵌/链接图片 */
export type MuseumDocBlock =
  | { type: "text"; text: string }
  | { type: "image"; src: string };

/** 图片源校验：仅接受 data: URI 与 http(s) URL */
const URLISH = /^(https?:\/\/|data:)/i;

/**
 * 智能解码纯文本文件（.txt/.md）：
 * - BOM 优先：UTF-8 / UTF-16LE / UTF-16BE 按 BOM 精确解码
 * - 无 BOM：先按 UTF-8 严格解码；失败或出现 \x00（UTF-16 特征）/
 *   U+FFFD 替换符（GBK 特征）时降级重试 —— Windows 记事本/WPS 保存的
 *   「Unicode」(UTF-16LE) 或 ANSI(GBK) 编码文件，直接 file.text() 会整篇乱码。
 */
export async function decodeTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.slice(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf.slice(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.slice(3));
  }
  let utf8 = "";
  try {
    utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return utf8;
  } catch {
    utf8 = new TextDecoder("utf-8").decode(buf);
  }
  if (/\u0000/.test(utf8)) {
    try {
      return new TextDecoder("utf-16le").decode(buf);
    } catch {
      /* 降级继续 */
    }
  }
  if (/\uFFFD/.test(utf8)) {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      /* 降级继续 */
    }
  }
  return utf8;
}

/**
 * 提取文档块流（文本 + 图片）：
 * - .docx：mammoth convertToHtml（内嵌图片转 data URI），再切分为块流
 * - .md / .txt：智能解码（BOM/UTF-16/GBK 兼容）后逐行扫描，
 *   Markdown 图片行 / 裸图片 URL 行识别为图片块
 */
export async function extractMuseumDocBlocks(file: File): Promise<MuseumDocBlock[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return htmlToBlocks(result.value);
  }
  return textToBlocks(await decodeTextFile(file));
}

/** 纯文本（.md/.txt）→ 块流：图片链接行识别为图片块，其余（含空行）保留为文本行 */
export function textToBlocks(text: string): MuseumDocBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\uFEFF/g, "").split("\n");
  const blocks: MuseumDocBlock[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    // Markdown 图片行：![alt](url)
    const mdImg = line.match(/^!\[[^\]]*\]\(\s*(\S+?)\s*\)$/);
    if (mdImg && URLISH.test(mdImg[1])) {
      blocks.push({ type: "image", src: mdImg[1] });
      continue;
    }
    // 裸图片 URL 行（以图片扩展名结尾）
    const bare = line.match(/^(https?:\/\/\S+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?\S*)?)$/i);
    if (bare) {
      blocks.push({ type: "image", src: bare[1] });
      continue;
    }
    // 裸 data: URI 图片行
    if (/^data:image\/[a-z+.-]+;base64,\S+$/i.test(line)) {
      blocks.push({ type: "image", src: line });
      continue;
    }
    blocks.push({ type: "text", text: raw });
  }
  return blocks;
}

/** mammoth HTML 实体解码（&amp; 必须最后处理，避免二次解码） */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * mammoth HTML → 块流。
 * 基于正则切分机器生成的高结构化 HTML（p/h1-6/li/td 块级元素 + img），
 * 浏览器与 Node 环境均可用（不依赖 DOMParser）。
 * 段落内的 <strong>/<em> 等行内标签会被剥离，文本合并在同一行；
 * 段内 <br> 拆分为独立文本行（利于标签行识别）。
 */
export function htmlToBlocks(html: string): MuseumDocBlock[] {
  const blocks: MuseumDocBlock[] = [];
  const re = /<(p|h[1-6]|li|td)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*?src="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    // 独立 <img>（不在块级元素内）
    if (m[3] !== undefined) {
      if (m[3] && URLISH.test(m[3])) blocks.push({ type: "image", src: m[3] });
      continue;
    }
    const inner = m[2] ?? "";
    // 标题块补回 Markdown 前缀（h1-h6 -> #/##/###...），供下游 heading 检测识别展品/章节结构
    const hLevel = /^h([1-6])$/i.exec(m[1] ?? "");
    const headingPrefix = hLevel ? "#".repeat(Number(hLevel[1])) + " " : "";
    // 段内文本（剥离行内标签 + 实体解码 + 空白收敛）
    for (const part of inner.split(/<br\s*\/?>/i)) {
      const text = decodeEntities(part.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (text) blocks.push({ type: "text", text: headingPrefix + text });
    }
    // 段内内嵌图片（mammoth 将 Word 内嵌图片置于段落中）
    const imgRe = /<img\b[^>]*?src="([^"]*)"[^>]*>/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner))) {
      if (im[1] && URLISH.test(im[1])) blocks.push({ type: "image", src: im[1] });
    }
  }
  return blocks;
}

const CJK_RE = /[\u4e00-\u9fff]/;

// ---------------------------------------------------------------------------
// 标签别名表（锚定整段标签文本，避免子串误匹配；具体标签在前、宽泛标签在后）
// ---------------------------------------------------------------------------
type TopLabelKey =
  | "nameCn"
  | "nameEn"
  | "name"
  | "country"
  | "city"
  | "address"
  | "coords"
  | "hours"
  | "intro"
  | "coverImage"
  | "guide"
  | "exhibits";

const TOP_LABELS: Array<[TopLabelKey, RegExp]> = [
  ["nameCn", /^(?:中文名称|中文名字|中文名|中文译名|中文标题|chinese\s*name)$/i],
  ["nameEn", /^(?:英文名称|英文名字|英文名|英文原名|英文标题|english\s*name)$/i],
  ["name", /^(?:博物馆名称|场馆名称|景点名称|博物馆|场馆|名称|标题|museum(?:\s*name)?|name|title)$/i],
  ["country", /^(?:国家(?:\/地区)?|country)$/i],
  ["city", /^(?:所在城市|城市|city)$/i],
  ["address", /^(?:详细地址|场馆地址|联系地址|地址|address|location)$/i],
  // 隐形高精坐标标签：【坐标】/【经纬度】/ 坐标 / 经纬度 / GPS（值形如 41.8914, 12.4965）。
  // 命中后直接写入 latitude/longitude，跳过网络地理编码；UI 不展示。
  ["coords", /^(?:【\s*(?:坐标|经纬度)\s*】|坐标|经纬度|gps)$/i],
  ["hours", /^(?:开放时间|营业时间|参观时间|开馆时间|opening\s*hours?|opening\s*times?|hours?|open)$/i],
  ["intro", /^(?:博物馆简介|场馆简介|简介|介绍|概述|描述|introduction|description|overview|about)$/i],
  ["coverImage", /^(?:封面图片|封面照片|封面图|封面|cover\s*(?:image|photo)|cover)$/i],
  ["guide", /^(?:导览图|导览地图|参观地图|馆内地图|地图|guide\s*maps?|maps?)$/i],
  [
    "exhibits",
    /^(?:核心展品|代表作品|馆藏精品|镇馆之宝|重点展品|展品列表|展品介绍|展品|highlights?|featured\s*(?:exhibits?|masterpieces?|works?)|exhibits?|masterpieces?)$/i,
  ],
];

type ExLabelKey = "nameCn" | "nameEn" | "name" | "story" | "background" | "image";

/** 单行标签值为空时挂起的回填目标 */
type PendingSingle = "name" | "nameCn" | "nameEn" | "country" | "city" | "address" | "coords" | "hours";

const EXHIBIT_LABELS: Array<[ExLabelKey, RegExp]> = [
  ["nameCn", /^(?:中文名称|中文名字|中文名|中文译名|chinese\s*name)$/i],
  ["nameEn", /^(?:英文名称|英文名字|英文名|英文原名|english\s*name)$/i],
  // 历史类标签需先于简介类判断，避免「历史背景」被「背景」吞掉
  ["story", /^(?:历史故事|历史背景|背后故事|背后的故事|历史|故事|historical\s*(?:story|background)?|history|story)$/i],
  ["image", /^(?:展品图片|展品照片|展品图|配图|图片|照片|image|photo)$/i],
  ["name", /^(?:展品名称|作品名称|展品标题|名称|标题|exhibit\s*name|name|title)$/i],
  ["background", /^(?:作品简介|作品背景|作品描述|背景介绍|简介|背景|描述|介绍|background|description|introduction|about)$/i],
];

/**
 * 展品起始行：「展品1：蒙娜丽莎」「作品一：X」「Exhibit 2: ...」。
 * 要求数字或分隔符紧跟关键词，避免把「作品完成于1503年」这类正文误判为展品标题。
 */
const RE_EXHIBIT_START =
  /^(?:(?:展品|作品|exhibits?|highlights?|masterpieces?)\s*(?:No\.?\s*)?(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[：:．.、\-–—]?|(?:展品|作品|exhibits?|highlights?|masterpieces?)\s*[：:．.、])\s*(.*)$/i;

/** 分隔线：--- / === / *** */
const RE_SEPARATOR = /^\s*(?:[-–—=_]{3,}|\*\s*\*\s*\*)\s*$/;

function matchKey<K extends string>(table: Array<[K, RegExp]>, label: string): K | null {
  for (const [key, re] of table) {
    if (re.test(label)) return key;
  }
  return null;
}

/** 剥离文本两侧包裹符（【】「」『』[] 引号等），支持「【国家】：意大利」写法 */
function stripWrapping(s: string): string {
  return s.replace(/^[【\[「『"'“]+|[】\]」』"'”]+$/g, "").trim();
}

/** 去除 Markdown 装饰（标题符 / 列表符 / 加粗 / 行内代码），保留正文。
 *  迭代剥离行首装饰，正确处理「- **名称：**」「1. **展品**」等组合标记。 */
function cleanLine(line: string): string {
  let s = line.trim();
  for (let i = 0; i < 4; i++) {
    const prev = s;
    s = s
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*•·>+]\s*/, "")
      .replace(/^\d{1,2}[.、)]\s*/, "")
      .replace(/^\*\*+/, "")
      .replace(/^__+/, "")
      .trim();
    if (s === prev) break;
  }
  // 移除行内残余强调符号（成对加粗/斜体/删除线/行内代码）
  return s.replace(/\*\*|__|~~|`/g, "").trim();
}

/**
 * 提取「中文脊柱」与外文余部（用于「中文 + 外文」并列/混合标题拆分）：
 * - 中文脊柱：从首个中文起、可跨空格/&/·/、//括号等连接符延伸的连续中文段
 *   （如「协和女神庙 & 卡斯托尔与波吕克斯神庙」「马森齐奥大会堂（诺瓦大会堂）」）
 * - 外文余部：原串移除中文脊柱、收敛空白并修剪连接符；仍含中文或无拉丁字母时
 *   视为不可可靠拆分，返回 null
 */
function splitZhPart(s: string): { zh: string; rest: string } | null {
  const m = s.match(/[\u4e00-\u9fff][\u4e00-\u9fff\s&·、，/\\|()（）[\]]*/);
  if (!m || m.index === undefined) return null;
  const zh = m[0].trim();
  const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length))
    .replace(/\s+/g, " ")
    .replace(/^[\s&·、，/\\|()（）[\]\-–—:：]+|[\s&·、，/\\|()（）[\]\-–—:：]+$/g, "")
    .trim();
  if (!zh || !rest || CJK_RE.test(rest) || !/[A-Za-z]/.test(rest)) return null;
  return { zh, rest };
}

/**
 * 双语标题拆分：
 * - 「蒙娜丽莎 Mona Lisa」/「Mona Lisa · 蒙娜丽莎」-> { name: "Mona Lisa", nameCn: "蒙娜丽莎" }
 * - 「卢浮宫（Musée du Louvre）」/「Musée du Louvre (卢浮宫)」-> 按括号内外语种归位
 * - 「凯撒神庙 Temple of Caesar (Tempio del Divo Giulio)」-> 括号外为「中文 + 外文」混合时：
 *   中文段 -> nameCn，外文余部与括号内容重组为完整外文名 -> name
 * - 纯中文 / 纯英文 -> 仅填充 name（原文即主标题）
 * - 无法可靠拆分 -> 整串作为 name
 */
export function splitBilingualName(raw: string): { name?: string; nameCn?: string } {
  const s = raw.replace(/^[\s"「『'“]+|[\s"」』'”]+$/g, "").trim();
  if (!s) return {};
  const hasZh = CJK_RE.test(s);
  const hasEn = /[A-Za-z]/.test(s);
  if (!hasZh || !hasEn) return { name: s };

  // 括号形式
  const paren = s.match(/^(.+?)[（(](.+?)[)）]$/);
  if (paren) {
    const outer = paren[1].trim();
    const inner = paren[2].trim();
    if (CJK_RE.test(outer) && !CJK_RE.test(inner) && /[A-Za-z]/.test(inner)) {
      // 外层为「中文 + 外文」混合（如「凯撒神庙 Temple of Caesar」）：继续拆分外层，
      // 外文余部与括号内容重组为完整外文名（保留括号内别名，不截断、不丢信息）
      if (/[A-Za-z]/.test(outer)) {
        const parts = splitZhPart(outer);
        if (parts) return { name: `${parts.rest} (${inner})`, nameCn: parts.zh };
      }
      return { name: inner, nameCn: outer };
    }
    if (CJK_RE.test(inner) && !CJK_RE.test(outer) && /[A-Za-z]/.test(outer)) {
      return { name: outer, nameCn: inner };
    }
  }

  // 空格 / 分隔符并列形式：中文脊柱 -> nameCn，外文余部 -> name
  const parts = splitZhPart(s);
  if (parts) return { name: parts.rest, nameCn: parts.zh };
  return { name: s };
}

/** 收敛多行文本：合并 3+ 连续换行、修剪首尾空白 */
function normalizeMultiline(v: string): string {
  return v
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// 核心解析器 — 流式逐块状态机（文本块走原有行级逻辑，图片块按上下文路由）
// ---------------------------------------------------------------------------
export function parseMuseumDocument(input: string | MuseumDocBlock[]): ParsedMuseumDoc {
  const blocks = typeof input === "string" ? textToBlocks(input) : input;

  const out: ParsedMuseumDoc = { exhibits: [], guideImages: [] };

  let inExhibits = false;
  let curEx: ParsedExhibitDraft | null = null;
  // 多行累积目标：简介 / 作品简介 / 历史故事（标签出现后，后续普通文本行持续追加）
  let sticky: "intro" | "background" | "story" | null = null;
  // 单行标签值为空时（如「国家：」换行「法国」），等待下一行普通文本回填
  let pendingSingle: PendingSingle | null = null;
  // 【导览图】章节模式：文本行忽略，图片归档到 guideImages
  let guideMode = false;
  // 简介是否已开始（用于判定「文档顶部 = 封面」的位置边界）
  let seenIntro = false;
  // 【封面图片】空标签/裸章节：强制下一张位置图片作为封面（即使简介已开始）
  let coverSection = false;
  // 【作品简介】锚点前瞻候选：展品章节内最后一行被并入当前展品字段（sticky 累积或
  // 兜底）的普通文本。当下一行命中「作品简介：/【作品简介】：/简介：」锚点时，该行
  // 100% 是新展品标题 —— 回溯摘除并以其开启新展品，免疫标题长短与 &/()/· 等特殊字符。
  let anchorCandidate: { line: string; field: "story" | "background" } | null = null;

  /** 图片路由：导览图章节 -> guideImages；展品区域 -> 当前展品照片；顶部/封面章节 -> 封面；其余归档 guideImages */
  const routeImage = (src: string) => {
    if (!URLISH.test(src)) return;
    if (guideMode) {
      out.guideImages.push({ src });
      return;
    }
    if (inExhibits) {
      const ex = curEx as ParsedExhibitDraft | null;
      if (ex && !ex.image) ex.image = { src };
      else out.guideImages.push({ src });
      return;
    }
    if (!out.coverImage && (coverSection || !seenIntro)) {
      out.coverImage = { src };
      coverSection = false;
    } else {
      out.guideImages.push({ src });
    }
  };

  const appendSticky = (val: string) => {
    const add = (cur: string) => {
      if (!val) return cur.endsWith("\n") ? cur : cur + "\n"; // 空行 -> 段落分隔
      return cur.endsWith("\n") || !cur ? cur + val : cur + "\n" + val;
    };
    if (sticky === "intro") out.intro = add(out.intro ?? "");
    else if (sticky === "background" && curEx) curEx.background = add(curEx.background);
    else if (sticky === "story" && curEx) curEx.story = add(curEx.story);
  };

  const startExhibit = (title: string) => {
    if (curEx) out.exhibits.push(curEx);
    // 修剪包裹符与尾部句读标点（锚点回溯的标题可能以句号结尾，如「展品乙 Exhibit B 。」）
    const cleanTitle = title
      .replace(/^[【\[]+|[】\]]+$/g, "")
      .replace(/\s*[。．！？!?，,；;]\s*$/, "")
      .trim();
    const { name, nameCn } = splitBilingualName(cleanTitle);
    curEx = { name: name ?? "", nameCn: nameCn ?? "", background: "", story: "" };
    sticky = null;
  };

  /**
   * 【作品简介】锚点回溯：将误并入上一展品字段（story/background）尾部的标题行摘除，
   * 并以其开启新展品。锚点判定与标题内容完全解耦 —— 标题长短、&/()/·// 等任意
   * 特殊字符均不影响识别（100% 免疫）。
   */
  const retrofitAnchorTitle = () => {
    if (!anchorCandidate) return;
    const { line, field } = anchorCandidate;
    const ex = curEx as ParsedExhibitDraft | null;
    if (!ex) return;
    const target = field === "story" ? ex.story : ex.background;
    const idx = target.lastIndexOf(line);
    if (idx === -1) return;
    const stripped = (target.slice(0, idx) + target.slice(idx + line.length)).replace(/\n+$/, "");
    if (field === "story") ex.story = stripped;
    else ex.background = stripped;
    startExhibit(line);
  };

  /** 进入展品章节；若行内携带列表（「核心展品：A、B」）则直接展开 */
  const enterExhibits = (inlineList?: string) => {
    inExhibits = true;
    guideMode = false;
    coverSection = false;
    sticky = null;
    pendingSingle = null;
    const list = inlineList?.trim();
    if (list) {
      for (const part of list.split(/[,，、;；]+/)) {
        const p = part.trim();
        if (p) startExhibit(p);
      }
    }
  };

  const setMuseumTitle = (raw: string) => {
    const { name, nameCn } = splitBilingualName(raw);
    if (!out.name && name) out.name = name;
    if (!out.nameCn && nameCn) out.nameCn = nameCn;
  };

  /** 展品子字段赋值（无当前展品时自动创建空展品，容错标签先于标题的文档） */
  const handleExhibitLabel = (key: ExLabelKey, value: string) => {
    if (key === "image") {
      sticky = null;
      if (!curEx) curEx = { name: "", nameCn: "", background: "", story: "" };
      if (value && URLISH.test(value)) curEx.image = { src: value };
      return;
    }
    if (key === "story" || key === "background") {
      if (!curEx) curEx = { name: "", nameCn: "", background: "", story: "" };
      sticky = key;
      if (value) appendSticky(value);
      return;
    }
    sticky = null;
    if (!curEx) curEx = { name: "", nameCn: "", background: "", story: "" };
    if (!value) return;
    if (key === "nameCn") curEx.nameCn = value;
    else if (key === "nameEn") curEx.name = value;
    else {
      const { name, nameCn } = splitBilingualName(value);
      if (name) curEx.name = name;
      if (nameCn) curEx.nameCn = nameCn;
    }
  };

  const handleTopLabel = (key: TopLabelKey, value: string) => {
    if (key !== "guide") guideMode = false;
    if (key === "exhibits") {
      enterExhibits(value);
      return;
    }
    if (key === "coverImage") {
      if (value && URLISH.test(value)) out.coverImage = { src: value };
      else coverSection = true; // 空标签/裸章节：等待下方位置图片作为封面
      sticky = null;
      pendingSingle = null;
      return;
    }
    if (key === "guide") {
      guideMode = true;
      inExhibits = false;
      coverSection = false;
      sticky = null;
      pendingSingle = null;
      if (value) {
        for (const part of value.split(/[,\s，、]+/)) {
          if (URLISH.test(part)) out.guideImages.push({ src: part });
        }
      }
      return;
    }
    if (key === "intro") {
      out.intro = value;
      sticky = "intro";
      seenIntro = true;
      pendingSingle = null;
      return;
    }
    sticky = null;
    coverSection = false;
    // 隐形坐标标签：解析「41.8914, 12.4965」直接写入 latitude/longitude
    if (key === "coords") {
      if (value) {
        const m = value.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
        if (m) {
          const lat = parseFloat(m[1]);
          const lng = parseFloat(m[2]);
          if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            out.latitude = lat;
            out.longitude = lng;
          }
        }
        pendingSingle = null;
      } else {
        // 值换行：等待下一行普通文本回填
        pendingSingle = "coords" as PendingSingle;
      }
      return;
    }
    if (value) {
      if (key === "name") setMuseumTitle(value);
      else if (key === "nameCn") out.nameCn = value;
      else if (key === "nameEn") out.name = value;
      else out[key] = value;
      pendingSingle = null;
    } else {
      pendingSingle = key;
    }
  };

  for (const block of blocks) {
    // ---- 图片块：按当前上下文路由 ----
    if (block.type === "image") {
      routeImage(block.src);
      continue;
    }

    const rawLine = block.text.replace(/[\u00a0\u3000]/g, " "); // 不间断空格 + 全角空格归一化
    const line = rawLine.trim();

    // 空行：作为多行字段的段落分隔
    if (!line) {
      if (sticky) appendSticky("");
      continue;
    }

    // 模板格式说明注释行（※ 开头）：中英文示范模板专用标记，导入时无条件忽略，
    // 避免英文模板的说明行被「首个短行 → 名称」规则误认为博物馆名称
    if (line.startsWith("※")) continue;

    // 分隔线
    if (RE_SEPARATOR.test(line)) continue;

    const cleaned = cleanLine(line);
    if (!cleaned) continue;

    const headingMatch = line.match(/^(#{1,6})\s+/);
    const headingLevel = headingMatch ? headingMatch[1].length : 0;
    // 编号列表项（1. / 2、 / 3)）：展品章节内视为新展品的枚举起点
    const numberedItem = /^\s*\d{1,2}[.、)]\s+/.test(line);

    // ---- 1. 标签行「标签：值」（宽容中英文冒号、标签两侧包裹符） ----
    const lm = cleaned.match(/^([^:：]{1,30}?)[：:]\s*(.*)$/);
    const label = lm ? stripWrapping(lm[1]) : "";
    const value = lm ? lm[2].trim() : "";

    // ---- 导览图章节拦截：文本行默认忽略；其他字段的标签行/章节行可退出该模式 ----
    if (guideMode && !inExhibits) {
      if (label) {
        const gk = matchKey(TOP_LABELS, label);
        if (!gk || gk === "guide" || gk === "coverImage") continue;
        guideMode = false; // 命中其他顶层字段（如「开放时间：」），退出导览图模式继续正常处理
      } else {
        const sk = matchKey(TOP_LABELS, stripWrapping(cleaned));
        if (sk === "exhibits") {
          enterExhibits();
          continue;
        }
        if (sk === "intro") {
          guideMode = false;
          out.intro = "";
          sticky = "intro";
          seenIntro = true;
          continue;
        }
        continue; // 其余文本行忽略
      }
    }

    if (label) {
      if (inExhibits) {
        const exKey = matchKey(EXHIBIT_LABELS, label);
        if (exKey) {
          // 【作品简介】锚点（标签式「作品简介：/【作品简介】：/简介：」，值可内联或换行）：
          // 其上一行有效非空文本 100% 是当前新展品的标题行 —— 前瞻回溯精准提取
          if (exKey === "background") retrofitAnchorTitle();
          handleExhibitLabel(exKey, value);
          continue;
        }
      }
      const topKey = matchKey(TOP_LABELS, label);
      if (topKey) {
        handleTopLabel(topKey, value);
        continue;
      }
      // 「展品1：蒙娜丽莎」在顶层直接出现时，自动进入展品章节
      if (!inExhibits) {
        const exStart = cleaned.match(RE_EXHIBIT_START);
        if (exStart) {
          enterExhibits();
          const rest = exStart[1].trim();
          if (rest) startExhibit(rest);
          continue;
        }
      }
      // 未识别标签：按普通文本行继续处理
    }

    // ---- 2. 展品章节内 ----
    if (inExhibits) {
      // 标题式锚点（无冒号形式「### 作品简介」/「【作品简介】」）同样触发回溯
      if (matchKey(EXHIBIT_LABELS, stripWrapping(cleaned)) === "background") {
        retrofitAnchorTitle();
      }
      // 消费型路径默认清空锚点候选；仅下方「并入当前展品字段」的两处路径回填
      anchorCandidate = null;
      const exStart = cleaned.match(RE_EXHIBIT_START);
      if (exStart) {
        const rest = exStart[1].trim();
        if (rest) startExhibit(rest);
        else enterExhibits();
        continue;
      }
      // 标题式子字段：「### 作品简介」「## 历史故事」（兼容「### 【作品简介】」包裹写法）
      const noColonKey = matchKey(EXHIBIT_LABELS, stripWrapping(cleaned));
      if (noColonKey === "story" || noColonKey === "background") {
        handleExhibitLabel(noColonKey, "");
        continue;
      }
      // 裸「展品图片」标签行：跳过，后续位置图片自动挂到当前展品
      if (noColonKey === "image") continue;
      // 顶层章节名（如「## 【导览图】」「## 核心展品」）：优先于展品标题，
      // 退出展品章节并进入对应章节模式，避免章节标题被误判为新展品
      const topSec = matchKey(TOP_LABELS, stripWrapping(cleaned));
      if (topSec === "guide" || topSec === "coverImage" || topSec === "exhibits") {
        if (curEx) {
          out.exhibits.push(curEx);
          curEx = null;
        }
        if (topSec === "exhibits") enterExhibits();
        else if (topSec === "guide") {
          guideMode = true;
          inExhibits = false;
        } else {
          coverSection = true;
          inExhibits = false;
        }
        sticky = null;
        pendingSingle = null;
        continue;
      }
      // Markdown 标题行（##/### 展品名）：无条件开启新展品（打断 sticky 多行累积）
      if (headingLevel > 0) {
        startExhibit(cleaned);
        continue;
      }
      // 编号列表项（1. 展品名）：无条件开启新展品（打断 sticky 多行累积）
      if (numberedItem) {
        startExhibit(cleaned);
        continue;
      }
      // 类型断言重置收窄：curEx 在上方 helper 闭包中被赋值，TS 无法跨闭包跟踪
      const ex = curEx as ParsedExhibitDraft | null;
      // 含冒号但未匹配任何已知标签的行（如「门票：20欧」）：并入当前展品简介，不误判为新展品
      if (label) {
        if (ex) {
          ex.background = ex.background ? ex.background + "\n" + cleaned : cleaned;
        }
        continue;
      }
      if (!ex) {
        startExhibit(cleaned);
        continue;
      }
      // 短且非句式的行视为下一个展品标题（兼容纯文本无 # / 无编号的展品列表）。
      // 必须先于 sticky 多行累积判断：否则「历史故事：」段落之后紧跟的
      // 下一展品裸标题行（如「圣母怜子像 Palestrina Pietà」）会被误并入
      // 上一个展品的故事字段 —— 纯文本文档（.txt/.md 与无标题样式的 .docx）必经此路径。
      // 字符兼容性放宽：标题行允许任意字符（中英文/意法文特殊字符/&/()/·//数字等），
      // 长度上限 150（如「灶神庙与贞女之家 Temple of Vesta & House of the Vestals」）；
      // 纯中文行维持 40 上限，防止软换行的故事正文被误判为标题 —— 超限纯中文标题由
      // 「作品简介」锚点前瞻 100% 兜底（见 retrofitAnchorTitle）。
      const titleLike =
        cleaned.length <= 150 &&
        !/[。．！？!?]$/.test(cleaned) &&
        (/[A-Za-zÀ-ÿ]/.test(cleaned) || cleaned.length <= 40);
      if (titleLike && (ex.background || ex.story)) {
        startExhibit(cleaned);
        continue;
      }
      if (sticky) {
        appendSticky(cleaned);
        // 记录锚点候选：该行已并入当前展品字段，若下一行是「作品简介」锚点则回溯为标题
        // （sticky 在闭包中被赋值，需显式宽化避免 TS 流分析误收窄）
        const stk = sticky as "intro" | "background" | "story";
        anchorCandidate =
          stk === "story" || stk === "background" ? { line: cleaned, field: stk } : null;
        continue;
      }
      ex.background = ex.background ? ex.background + "\n" + cleaned : cleaned;
      anchorCandidate = { line: cleaned, field: "background" };
      continue;
    }

    // ---- 3. 顶层无标签行 ----
    // 裸章节名（无冒号、无 # 的「核心展品」/「【核心展品】」/「**核心展品**」）：进入对应章节
    const sectionKey = matchKey(TOP_LABELS, stripWrapping(cleaned));
    if (sectionKey === "exhibits") {
      enterExhibits();
      continue;
    }
    if (sectionKey === "intro") {
      out.intro = "";
      sticky = "intro";
      seenIntro = true;
      continue;
    }
    if (sectionKey === "guide") {
      guideMode = true;
      sticky = null;
      pendingSingle = null;
      continue;
    }
    if (sectionKey === "coverImage") {
      coverSection = true;
      sticky = null;
      pendingSingle = null;
      continue;
    }
    if (headingLevel > 0) {
      if (headingLevel === 1 || !out.name) {
        setMuseumTitle(cleaned);
        continue;
      }
      // 其余未知标题（如「## 参观信息」）忽略，交由后续标签行补齐字段
      continue;
    }

    if (pendingSingle) {
      // 类型断言重置收窄：pendingSingle 在 handleTopLabel 闭包中被赋值
      const pk = pendingSingle as PendingSingle;
      if (pk === "name") setMuseumTitle(cleaned);
      else if (pk === "nameCn") out.nameCn = cleaned;
      else if (pk === "nameEn") out.name = cleaned;
      else if (pk === "coords") {
        // 坐标标签值换行回填：「41.8914, 12.4965」
        const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
        if (m) {
          const lat = parseFloat(m[1]);
          const lng = parseFloat(m[2]);
          if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            out.latitude = lat;
            out.longitude = lng;
          }
        }
      } else out[pk] = cleaned;
      pendingSingle = null;
      continue;
    }

    if (sticky === "intro") {
      appendSticky(cleaned);
      continue;
    }

    // 首个非空短文本行且尚未有标题 -> 视为名称/标题（含冒号的标签式行排除）
    if (!out.name && !label && cleaned.length <= 80 && !/[。．！？!?]$/.test(cleaned)) {
      setMuseumTitle(cleaned);
      continue;
    }
    // 其余顶层散文本（文档前言等）忽略
  }

  if (curEx) out.exhibits.push(curEx);

  // ---- 收敛输出：过滤空值，仅保留真实解析到的字段 ----
  const result: ParsedMuseumDoc = {
    coverImage:
      out.coverImage && URLISH.test(out.coverImage.src) ? out.coverImage : undefined,
    guideImages: out.guideImages.filter((g) => URLISH.test(g.src)),
    exhibits: out.exhibits
      .map((e) => ({
        name: e.name.trim(),
        nameCn: e.nameCn.trim(),
        background: normalizeMultiline(e.background),
        story: normalizeMultiline(e.story),
        image: e.image && URLISH.test(e.image.src) ? e.image : undefined,
      }))
      .filter((e) => e.name || e.nameCn || e.background || e.story || e.image),
  };
  const maybe = (v?: string): string | undefined => {
    const n = v ? normalizeMultiline(v) : "";
    return n || undefined;
  };
  const name = maybe(out.name);
  const nameCn = maybe(out.nameCn);
  const country = maybe(out.country);
  const city = maybe(out.city);
  const address = maybe(out.address);
  const hours = maybe(out.hours);
  const intro = maybe(out.intro);
  if (name) result.name = name;
  if (nameCn) result.nameCn = nameCn;
  if (country) result.country = country;
  if (city) result.city = city;
  if (address) result.address = address;
  if (hours) result.hours = hours;
  if (intro) result.intro = intro;
  // 隐形高精坐标：内部地图定位专用，UI 不展示
  if (out.latitude != null && out.longitude != null) {
    result.latitude = out.latitude;
    result.longitude = out.longitude;
  }

  return result;
}
