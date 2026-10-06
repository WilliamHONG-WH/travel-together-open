/**
 * Dynamic Reverse Geocoding utilities — 100% 动态逆地理编码
 * Uses OpenStreetMap Nominatim API (free, no API key required).
 *
 * 所有请求均根据当前 App 语言强制带上 `accept-language` 参数（URL + Header 双重传递），
 * 从源头获取对应语言的标准地名，避免后续中英文混杂显示。
 */

import { getLocalizedCountry, getLocalizedCity, resolveCountryKey } from "@/constants/locations";
import { lookupCityEntry, COUNTRY_CODE_EN_MAP } from "@/lib/geo-i18n";

export function cleanCityName(cityName: string, isEn: boolean): string {
  if (!cityName) return isEn ? "Unknown" : "未知区域";
  // 清洗分号拼接的多语言重复名（如 "洛杉矶;洛杉矶" → "洛杉矶"）
  const cleaned = cityName.split(/[;；]/)[0].trim();
  if (!cleaned) return isEn ? "Unknown" : "未知区域";
  if (isEn) return cleaned;
  // 去除中文常见的行政区尾缀，如 "深圳市" -> "深圳"
  return cleaned.replace(/(市|特别行政区|自治区|自治州|盟|区|县)$/, "");
}

/**
 * 常用旅游城市中心坐标（纬度, 经度）— 精准地理编码失败时的保底坐标。
 * key 对应 src/constants/locations.ts 中 GLOBAL_LOCATIONS[].cities[].key。
 */
const CITY_CENTER_COORDS: Record<string, [number, number]> = {
  // 意大利
  rome: [41.9028, 12.4964],
  milan: [45.4642, 9.19],
  venice: [45.4408, 12.3155],
  florence: [43.7696, 11.2558],
  naples: [40.8518, 14.2681],
  // 法国 / 英国 / 西班牙
  paris: [48.8566, 2.3522],
  london: [51.5074, -0.1278],
  madrid: [40.4168, -3.7038],
  barcelona: [41.3851, 2.1734],
  // 德国 / 荷兰 / 奥地利 / 匈牙利 / 葡萄牙 / 捷克
  berlin: [52.52, 13.405],
  munich: [48.1351, 11.582],
  amsterdam: [52.3676, 4.9041],
  vienna: [48.2082, 16.3738],
  budapest: [47.4979, 19.0402],
  lisbon: [38.7223, -9.1393],
  prague: [50.0755, 14.4378],
  // 东亚 / 东南亚
  tokyo: [35.6762, 139.6503],
  kyoto: [35.0116, 135.7681],
  osaka: [34.6937, 135.5023],
  seoul: [37.5665, 126.978],
  bangkok: [13.7563, 100.5018],
  singapore: [1.3521, 103.8198],
  beijing: [39.9042, 116.4074],
  shanghai: [31.2304, 121.4737],
  "hong-kong": [22.3193, 114.1694],
};

/**
 * 获取城市中心坐标（保底定位）。
 * @returns { lat, lng }，未知城市返回 null。
 */
export function getCityCenter(
  cityKey?: string,
  countryKey?: string,
): { lat: number; lng: number } | null {
  if (!cityKey) return null;
  const hit = CITY_CENTER_COORDS[cityKey.trim().toLowerCase()];
  if (hit) return { lat: hit[0], lng: hit[1] };
  // 仅有国家时：用国家首都/代表城市兜底
  if (countryKey) {
    const capital = COUNTRY_CENTER_COORDS[countryKey.trim().toLowerCase()];
    if (capital) return { lat: capital[0], lng: capital[1] };
  }
  return null;
}

/** 国家代表坐标（城市缺失时兜底） */
const COUNTRY_CENTER_COORDS: Record<string, [number, number]> = {
  italy: [41.9028, 12.4964],
  france: [48.8566, 2.3522],
  uk: [51.5074, -0.1278],
  spain: [40.4168, -3.7038],
  germany: [52.52, 13.405],
  netherlands: [52.3676, 4.9041],
  austria: [48.2082, 16.3738],
  hungary: [47.4979, 19.0402],
  portugal: [38.7223, -9.1393],
  "czech-republic": [50.0755, 14.4378],
  japan: [35.6762, 139.6503],
  "south-korea": [37.5665, 126.978],
  thailand: [13.7563, 100.5018],
  singapore: [1.3521, 103.8198],
  china: [39.9042, 116.4074],
};

/** 检测字符串是否含 CJK 字符（中文/日文汉字 + 全角标点） */
function hasCJK(s: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(s);
}

/**
 * 权威地标坐标字典（人工校准的建筑级高精坐标）。
 * 优先级高于 Nominatim：规避「梵蒂冈博物馆被定位到火车站」之类的系统性偏移，
 * 中文/外文名称命中即直接返回，零网络开销、零误差。
 */
const CURATED_LANDMARK_COORDS: Record<string, [number, number]> = {
  // ── 罗马 ──
  "梵蒂冈博物馆": [41.9067, 12.4534],
  "梵蒂冈美术馆": [41.9067, 12.4534],
  "圣彼得大教堂": [41.9022, 12.4539],
  "圣伯多禄大殿": [41.9022, 12.4539],
  "罗马斗兽场": [41.8902, 12.4922],
  "斗兽场": [41.8902, 12.4922],
  "万神庙": [41.8986, 12.4769],
  "万神殿": [41.8986, 12.4769],
  "特雷维喷泉": [41.9009, 12.4833],
  "许愿池": [41.9009, 12.4833],
  "古罗马广场": [41.8925, 12.4853],
  "帕拉丁山": [41.8887, 12.4868],
  "图拉真广场": [41.8953, 12.4851],
  "卡拉卡拉大浴场": [41.8790, 12.4924],
  // 罗马国家博物馆四分馆（售票大门精准坐标）
  "戴克里先浴场": [41.9029, 12.4984],
  "马西莫宫": [41.9014, 12.4981],
  "阿尔滕普斯宫": [41.9011, 12.4731],
  "坦比哀多": [41.8884, 12.4664],
  "圣伯多禄锁链堂": [41.8939, 12.4932],
  "河畔圣方济各堂": [41.8856, 12.4739],
  "尼禄金宫": [41.8914, 12.4965],
  // ── 佛罗伦萨 ──
  "乌菲兹美术馆": [43.7678, 11.2553],
  "乌菲齐美术馆": [43.7678, 11.2553],
  "圣母百花大教堂": [43.7731, 11.2560],
  "学院美术馆": [43.7769, 11.2587],
  // ── 米兰 / 其他 ──
  "米兰大教堂": [45.4641, 9.1919],
  "感恩圣母修道院": [45.4660, 9.1710],
  "比萨斜塔": [43.7230, 10.3966],
  "贝加莫上城": [45.7042, 9.6631],
  // ── 威尼斯 ──
  "格里马尼宫": [45.4363, 12.3424],
  "黄金宫": [45.4406, 12.3338],
  "总督府": [45.4337, 12.3404],
  "圣马可大教堂": [45.4345, 12.3397],
};

/**
 * 归一化地标名称匹配：去除空格/中英标点/常见前后缀后精确比对。
 * @returns 命中返回坐标，未命中返回 null
 */
export function getCuratedLandmarkCoord(name?: string): { lat: number; lng: number } | null {
  if (!name) return null;
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s·・,，。.、:：;；()（）\[\]【】"'`''""]/g, "")
      .replace(/(博物馆|美术馆|museum|gallery)$/i, "");
  const key = normalize(name);
  if (!key) return null;
  for (const [landmark, coord] of Object.entries(CURATED_LANDMARK_COORDS)) {
    if (normalize(landmark) === key) return { lat: coord[0], lng: coord[1] };
  }
  return null;
}

/**
 * 解析文档预埋的「隐形高精坐标」标签行。
 * 支持格式：【坐标】：41.8914, 12.4965 / 坐标：41.8914, 12.4965 / 【经纬度】：41.8914, 12.4965 /
 *           经纬度: 41.8914, 12.4965 / GPS: 41.8914, 12.4965
 * @returns 解析出 { lat, lng }，非坐标行返回 null
 */
export function parseEmbeddedCoordLine(line: string): { lat: number; lng: number } | null {
  const m = line.match(
    /^(?:【\s*(?:坐标|经纬度)\s*】|\[\s*(?:坐标|经纬度)\s*\]|坐标|经纬度|GPS)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/i,
  );
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  // 合法性校验：纬度 [-90, 90]，经度 [-180, 180]
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Forward geocode a free-text query to lat/lng.
 * Uses OpenStreetMap Nominatim search API (free, no API key required).
 *
 * @param query 查询串，如 "Uffizi Gallery, Piazzale degli Uffizi, Florence, Italy"
 * @returns { lat, lng }，失败时返回 null（不抛错，调用方自行降级）
 */
export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=en&q=${encodeURIComponent(q)}`,
      {
        headers: {
          // 必须携带自定义 UA，避免被 OpenStreetMap 以 403 拦截
          "User-Agent": "TravelTogetherApp/1.0",
          "Accept-Language": "en",
        },
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (isFinite(lat) && isFinite(lng)) return { lat, lng };
    }
    return null;
  } catch (err) {
    console.warn("Forward geocoding failed:", err);
    return null;
  }
}

/**
 * 智能清洗地址中的干扰片段，提高 Nominatim 结构化搜索命中率：
 * - 独立邮编 token（4-6 位纯数字，如意大利 00187）
 * - 独立省份/州缩写（2 位大写字母，如 RM / MI / FI）
 * - 与城市名同名的 token（本地化英文名与原始输入均尝试，忽略大小写）
 * 例：「Via degli Avignonesi, 22, 00187 Roma RM」→「Via degli Avignonesi, 22」
 * 清洗后为空串时调用方应跳过 street 搜索（裸城市名不是街道）。
 */
export function cleanStreetAddress(address: string, ...cityVariants: string[]): string {
  let s = address.trim();
  if (!s) return "";
  const cities = cityVariants.map((c) => (c || "").trim()).filter(Boolean);
  // 1) 独立邮编 token（4-6 位数字）
  s = s.replace(/(^|[\s,，])\d{4,6}(?=[\s,，]|$)/g, "$1");
  // 2) 独立省份缩写（2 位大写字母）
  s = s.replace(/(^|[\s,，])[A-Z]{2}(?=[\s,，]|$)/g, "$1");
  // 3) 城市同名 token（忽略大小写）
  for (const c of cities) {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(^|[\\s,，])${esc}(?=[\\s,，]|$)`, "gi"), "$1");
  }
  // 4) 压缩残留空格/分隔符
  return s.replace(/[\s,，]+/g, " ").replace(/^[\s,，]+|[\s,，]+$/g, "").trim();
}

/**
 * 三级「建筑级精准」地理编码 + 权威地标字典 —— 定位优先级流水线：
 *
 *   0. 权威地标字典（CURATED_LANDMARK_COORDS，人工校准，优先级最高）
 *   1. 结构化详细地址搜索（Nominatim street/city/country 参数）
 *   2. 外文地标名搜索（nameCn/subtitle + 城市 + 国家）
 *   3. 中文地标名搜索（title + 城市 + 国家）
 *
 * 失败处理：全部未命中时返回 null —— 调用方保留
 * latitude: null / longitude: null，绝不使用城市中心坐标充数，
 * 从根源上杜绝所有场馆重叠在城市中心点。
 *
 * 注：文档预埋坐标由解析器直接写入数据，优先于本函数（调用方先检查）。
 */
export async function geocodeVenuePrecise(input: {
  name?: string;
  /** 外文名称（Museum.nameCn / DB subtitle），第 2 级优先使用 */
  foreignName?: string;
  address?: string;
  cityKey?: string;
  countryKey?: string;
}): Promise<{ lat: number; lng: number } | null> {
  const name = (input.name || "").trim();
  const foreignName = (input.foreignName || "").trim();
  const address = (input.address || "").trim();
  const city = input.cityKey ? getLocalizedCity(input.cityKey, "en") : "";
  const country = input.countryKey ? getLocalizedCountry(input.countryKey, "en") : "";

  // ── 第 0 级：权威地标字典（零网络开销，规避 Nominatim 系统性偏移）──
  const curated =
    getCuratedLandmarkCoord(name) ?? getCuratedLandmarkCoord(foreignName);
  if (curated) return curated;

  // ── 第 1 级：结构化详细地址搜索（street 参数 + city + country）──
  // 地址须为外文（含中文的地址 Nominatim 结构化查询无法解析，跳过）。
  // 优先用智能清洗后的纯街道名（去邮编/省份缩写/城市同名 token）搜索，
  // 未命中再用原始地址兜底一次，最后落入第 2/3 级【名称 + 城市】搜索。
  if (address && !hasCJK(address)) {
    const cleaned = cleanStreetAddress(address, city, input.cityKey ?? "");
    const attempts = cleaned && cleaned !== address ? [cleaned, address] : [address];
    for (const street of attempts) {
      const params = new URLSearchParams({
        street,
        ...(city ? { city } : {}),
        ...(country ? { country } : {}),
        format: "json",
        limit: "1",
      });
      const hit = await nominatimSearch(params);
      if (hit) return hit;
    }
  }

  // ── 第 2 级：外文地标名 + 城市 + 国家 ──
  const foreign = [foreignName, name]
    .map((s) => (s || "").trim())
    .find((s) => s && !hasCJK(s));
  if (foreign) {
    const hit = await forwardGeocode([foreign, city, country].filter(Boolean).join(", "));
    if (hit) return hit;
  }

  // ── 第 3 级：中文地标名 + 城市 + 国家（Nominatim 支持中文 POI 名称检索）──
  if (name && hasCJK(name)) {
    const hit = await forwardGeocode([name, city, country].filter(Boolean).join(", "));
    if (hit) return hit;
  }

  return null;
}

/** Nominatim /search 通用请求（统一 UA，避免 OSM 403 拦截） */
async function nominatimSearch(params: URLSearchParams): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        // 必须携带自定义 UA，避免被 OpenStreetMap 以 403 拦截
        "User-Agent": "TravelTogetherApp/1.0",
        "Accept-Language": "en",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (isFinite(lat) && isFinite(lng)) return { lat, lng };
    }
    return null;
  } catch (err) {
    console.warn("Nominatim search failed:", err);
    return null;
  }
}

/**
 * 场馆级正向地理编码 —— 三级建筑级精准查询的统一入口。
 * 三级均未命中时返回 null，调用方保留 latitude/longitude 为 null，
 * 绝不使用城市中心坐标充数（杜绝场馆重叠在城市中心点）。
 */
export async function geocodeVenue(input: {
  name?: string;
  foreignName?: string;
  address?: string;
  cityKey?: string;
  countryKey?: string;
}): Promise<{ lat: number; lng: number } | null> {
  return geocodeVenuePrecise(input);
}

/** 判断坐标是否为城市中心保底值（用于检测并重算历史数据） */
export function isCityCenterCoord(
  lat: number | null | undefined,
  lng: number | null | undefined,
  cityKey?: string,
  countryKey?: string,
): boolean {
  if (lat == null || lng == null) return false;
  const center = getCityCenter(cityKey, countryKey);
  if (!center) return false;
  // 容差 1e-4（约 11 米）：与城市中心表完全一致即视为保底值
  return Math.abs(lat - center.lat) < 1e-4 && Math.abs(lng - center.lng) < 1e-4;
}

/**
 * Reverse geocode lat/lng to a human-readable city name.
 *
 * 升级：请求带上 `namedetails=1`，从 OSM 官方多语言标签中同时提取
 * 中文名（name:zh）与英文名（name:en），并经 geo-i18n 权威字典标准化清洗
 * （繁体「米蘭」→「米兰」、本地拼写「Milano」→「Milan」），
 * 绝不向调用方返回未清洗的繁体字。
 *
 * @param lat Latitude
 * @param lng Longitude
 * @param lang Language code ("en" or "zh")
 * @returns City name string, or "Unknown"/"未知区域" on failure
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  lang: string,
): Promise<string> {
  const isEn = lang === "en";
  const acceptLang = isEn ? "en" : "zh-CN";
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&namedetails=1&accept-language=${acceptLang}`,
      {
        headers: {
          "User-Agent": "GongFuShanHeTravelApp/1.0",
          "Accept-Language": acceptLang,
        },
      },
    );
    if (!response.ok) throw new Error("Geocoding failed");
    const data = await response.json();
    if (data && data.address) {
      const addr = data.address;
      const namedetails: Record<string, string> = data.namedetails || {};
      const rawCity =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.county ||
        addr.suburb ||
        addr.city_district ||
        addr.state ||
        "";
      // 官方中文名优先 name:zh；英文名优先 name:en，本地名（Milano）兜底
      const zhCandidate = namedetails["name:zh"] || rawCity;
      const enCandidate = namedetails["name:en"] || rawCity || namedetails.name || "";
      // 权威字典标准化（繁体→简体、本地拼写→英文），两侧任一命中即以字典为准
      const std = lookupCityEntry(zhCandidate) ?? lookupCityEntry(enCandidate);
      if (std) return isEn ? std.en : std.zh;
      return cleanCityName(isEn ? enCandidate : zhCandidate, isEn);
    }
    return isEn ? "Unknown" : "未知区域";
  } catch (err) {
    console.error("Reverse geocoding error:", err);
    return isEn ? "Unknown" : "未知区域";
  }
}

/**
 * 完整逆地理编码：返回结构化双语地名
 *
 * 升级要点（打卡源头双语标准化）：
 * - 请求带上 `namedetails=1`，一次请求同时拿到 OSM 官方多语言标签：
 *   中文城市名优先 `namedetails['name:zh']`，其次 address.city / address.town；
 *   英文城市名优先 `namedetails['name:en']`，本地名（Milano）兜底；
 *   英文国家名直接由 `address.country_code` 映射 ISO 标准英文国名。
 * - 所有候选名经 geo-i18n 权威字典清洗（繁体「米蘭」→「米兰」），
 *   绝不保存/返回繁体字。
 * - `city` / `country` / `display` 按请求语言返回（保持旧契约，调用方无感）；
 *   `cityZh` / `cityEn` / `countryZh` / `countryEn` 为额外双语字段，供打卡
 *   流程直接写入或展示层切换语言使用。
 *
 * @param lat  Latitude
 * @param lng  Longitude
 * @param lang Language code ("en" or "zh"；"zh-CN" / "zh-TW" 等以 "zh" 开头的均视为中文）
 * @returns { full, city, country, display, cityZh, cityEn, countryZh, countryEn }
 *          失败时返回英文 "Unknown Location" 兜底
 */
export async function reverseGeocodeFull(
  lat: number,
  lng: number,
  lang: string,
): Promise<{
  full: string;
  city: string;
  country: string;
  display: string;
  cityZh: string;
  cityEn: string;
  countryZh: string;
  countryEn: string;
}> {
  const isEn = !lang || !lang.startsWith("zh");
  // 双语优先级：中文优先、英文兜底（address.* 字段在 zh 缺失时自动回退 en）
  const acceptLang = "zh-CN,en";
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${acceptLang}&addressdetails=1&namedetails=1`,
      {
        headers: {
          "User-Agent": "GongFuShanHeTravelApp/1.0",
          "Accept-Language": acceptLang,
        },
      },
    );
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    const addr: Record<string, string | undefined> = data.address || {};
    const namedetails: Record<string, string> = data.namedetails || {};
    const full = data.display_name || "Unknown Location";

    // ── 城市双语提取 ──
    const rawCity =
      addr.city || addr.town || addr.village || addr.municipality ||
      addr.county || addr.hamlet || addr.suburb || "";
    const zhCandidate = namedetails["name:zh"] || rawCity;
    const enCandidate = namedetails["name:en"] || namedetails.name || rawCity || "";
    // 权威字典标准化：两侧任一命中即以字典为准（繁体→简体、本地拼写→英文）
    const std = lookupCityEntry(zhCandidate) ?? lookupCityEntry(enCandidate);
    const cityZh = std?.zh ?? cleanCityName(zhCandidate, false);
    const cityEn = std?.en ?? cleanCityName(enCandidate || zhCandidate, true);

    // ── 国家双语提取 ──
    const rawCountry = (addr.country || "").split(/[;；]/)[0].trim();
    const countryCode = (addr.country_code || "").toUpperCase();
    // 英文国名：ISO country_code 精确映射（杜绝本地语言国名混杂）
    const countryEn =
      COUNTRY_CODE_EN_MAP[countryCode] ||
      rawCountry ||
      (resolveCountryKey(rawCountry)
        ? getLocalizedCountry(resolveCountryKey(rawCountry)!, "en")
        : "");
    // 中文国名：zh-CN 优先响应天然为中文；否则查全局字典反译
    const countryZh = hasCJK(rawCountry)
      ? rawCountry
      : (resolveCountryKey(rawCountry)
          ? getLocalizedCountry(resolveCountryKey(rawCountry)!, "zh")
          : rawCountry);

    const city = isEn ? cityEn : cityZh;
    const country = isEn ? countryEn : countryZh;
    const display = city && country ? `${city}, ${country}` : full;

    return { full, city, country, display, cityZh, cityEn, countryZh, countryEn };
  } catch (err) {
    console.error("Reverse geocoding (full) error:", err);
    return {
      full: "Unknown Location",
      city: "",
      country: "",
      display: "Unknown Location",
      cityZh: "",
      cityEn: "",
      countryZh: "",
      countryEn: "",
    };
  }
}
