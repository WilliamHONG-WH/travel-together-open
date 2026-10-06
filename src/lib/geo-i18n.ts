/**
 * 地名国际化权威字典 —— 全站地名的唯一标准化来源
 * ─────────────────────────────────────────────────────────────────
 * 解决的问题：
 * 1. Nominatim 逆地理编码（accept-language=zh-CN）可能返回繁体中文（如「米蘭」），
 *    直接入库会导致全站显示繁简混杂；
 * 2. 本地拼写（Milano / Roma / Firenze / Venezia）与英文标准名不一致；
 * 3. 小众城市 / 国内区县（Busto Arsizio、虹桥、晋江等）中英映射缺失。
 *
 * 使用方式：
 * - 写入侧（打卡/票据保存前）：lookupCityEntry() 标准化清洗，绝不保存繁体；
 * - 显示侧（utils/location、stamps/types）：优先查本表，新旧数据（含历史
 *   繁体行）统一映射为标准简体中文 / 英文。
 */

export interface BilingualName {
  zh: string;
  en: string;
}

/**
 * 权威城市双向映射字典
 * key 兼容：英文标准名（小写）、简体中文、繁体中文、本地拼写、行政区划尾缀变体。
 * value 恒为「标准简体中文 + 标准英文」。
 */
export const CITY_MAP: Record<string, BilingualName> = {
  // ── 核心城市（包含繁体和本地拼写兼容）──
  milan: { zh: "米兰", en: "Milan" },
  "米兰": { zh: "米兰", en: "Milan" },
  "米蘭": { zh: "米兰", en: "Milan" },
  milano: { zh: "米兰", en: "Milan" },

  rome: { zh: "罗马", en: "Rome" },
  "罗马": { zh: "罗马", en: "Rome" },
  "羅馬": { zh: "罗马", en: "Rome" },
  roma: { zh: "罗马", en: "Rome" },

  florence: { zh: "佛罗伦萨", en: "Florence" },
  "佛罗伦萨": { zh: "佛罗伦萨", en: "Florence" },
  "佛罗伦斯": { zh: "佛罗伦萨", en: "Florence" },
  "佛羅倫斯": { zh: "佛罗伦萨", en: "Florence" },
  "佛羅倫薩": { zh: "佛罗伦萨", en: "Florence" },
  firenze: { zh: "佛罗伦萨", en: "Florence" },

  venice: { zh: "威尼斯", en: "Venice" },
  "威尼斯": { zh: "威尼斯", en: "Venice" },
  "威尼司": { zh: "威尼斯", en: "Venice" },
  venezia: { zh: "威尼斯", en: "Venice" },

  bergamo: { zh: "贝加莫", en: "Bergamo" },
  "贝加莫": { zh: "贝加莫", en: "Bergamo" },
  "貝加莫": { zh: "贝加莫", en: "Bergamo" },

  pisa: { zh: "比萨", en: "Pisa" },
  "比萨": { zh: "比萨", en: "Pisa" },
  "比薩": { zh: "比萨", en: "Pisa" },

  // ── 小众机场/城市（Google 地图标准译名）──
  "busto arsizio": { zh: "布斯托阿西齐奥", en: "Busto Arsizio" },
  "布斯托阿西齐奥": { zh: "布斯托阿西齐奥", en: "Busto Arsizio" },
  ferno: { zh: "费尔诺", en: "Ferno" },
  "费尔诺": { zh: "费尔诺", en: "Ferno" },
  "somma lombardo": { zh: "索马隆巴尔多", en: "Somma Lombardo" },
  gallarate: { zh: "加拉拉泰", en: "Gallarate" },

  // ── 国内城市 ──
  hongqiao: { zh: "虹桥", en: "Hongqiao" },
  "虹桥": { zh: "虹桥", en: "Hongqiao" },
  jinjiang: { zh: "晋江", en: "Jinjiang" },
  "晋江": { zh: "晋江", en: "Jinjiang" },
  "晋江市": { zh: "晋江", en: "Jinjiang" },
  longyan: { zh: "龙岩", en: "Longyan" },
  "龙岩": { zh: "龙岩", en: "Longyan" },
  yichang: { zh: "宜昌", en: "Yichang" },
  "宜昌": { zh: "宜昌", en: "Yichang" },
  dawanzi: { zh: "大湾子", en: "Dawanzi" },
  "大湾子": { zh: "大湾子", en: "Dawanzi" },
};

/**
 * ISO 3166-1 alpha-2 国家代码 → 标准英文国名
 * 逆地理编码时直接以 address.country_code 精确映射，杜绝本地语言国名混杂。
 */
export const COUNTRY_CODE_EN_MAP: Record<string, string> = {
  it: "Italy", fr: "France", gb: "United Kingdom", us: "United States",
  es: "Spain", de: "Germany", nl: "Netherlands", at: "Austria",
  hu: "Hungary", pt: "Portugal", cz: "Czech Republic", gr: "Greece",
  ch: "Switzerland", be: "Belgium", ie: "Ireland", dk: "Denmark",
  no: "Norway", se: "Sweden", fi: "Finland", pl: "Poland",
  ru: "Russia", ua: "Ukraine", tr: "Turkey", hr: "Croatia",
  si: "Slovenia", mc: "Monaco", li: "Liechtenstein", va: "Vatican City",
  sm: "San Marino", lu: "Luxembourg",
  jp: "Japan", kr: "South Korea", th: "Thailand", sg: "Singapore",
  my: "Malaysia", vn: "Vietnam", id: "Indonesia", ph: "Philippines",
  in: "India", cn: "China", hk: "Hong Kong", mo: "Macao", tw: "Taiwan",
  au: "Australia", nz: "New Zealand", ca: "Canada", mx: "Mexico",
  br: "Brazil", ar: "Argentina", eg: "Egypt", ma: "Morocco",
  ae: "United Arab Emirates", za: "South Africa",
};

/** 清洗并归一化为字典 key：取分号首段、trim、小写、压缩空格 */
function normalizeKey(raw: string): string {
  return (raw || "").split(/[;；]/)[0].trim().toLowerCase().replace(/\s+/g, " ");
}

/** 剥离行政区尾缀（「晋江市」→「晋江」、「Jinjiang City」→「jinjiang」） */
function stripAdminSuffix(s: string): string {
  return s
    .replace(/[,\s]+city\s*(district|municipality)?$/i, "")
    .replace(/(市|区|县|镇|村|特别行政区|自治区|自治州|盟)$/u, "")
    .trim();
}

/**
 * 权威字典查询：任意语言 / 繁简 / 本地拼写 / 带行政尾缀的城市名
 * → 标准双语名 { zh, en }。未命中返回 null，由调用方决定兜底策略。
 */
export function lookupCityEntry(
  raw: string | null | undefined,
): BilingualName | null {
  if (!raw) return null;
  const cleaned = normalizeKey(raw);
  if (!cleaned) return null;
  const direct = CITY_MAP[cleaned];
  if (direct) return direct;
  const stripped = stripAdminSuffix(cleaned);
  if (stripped && stripped !== cleaned) {
    return CITY_MAP[stripped] || null;
  }
  return null;
}

/**
 * 按语言标准化城市名（写入 DB / 展示前的清洗入口）。
 * @returns 命中字典返回对应语言的标准名；未命中返回 null（调用方自行兜底）
 */
export function standardizeCity(
  raw: string | null | undefined,
  lang: string,
): string | null {
  const hit = lookupCityEntry(raw);
  if (!hit) return null;
  return lang && lang.startsWith("zh") ? hit.zh : hit.en;
}
