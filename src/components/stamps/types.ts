export type StampCategory = "cities" | "nature" | "food";

import { getCountryEntryByCity } from "@/constants/locations";
import { lookupCityEntry } from "@/lib/geo-i18n";

export interface StampCreator {
  name: string;
  color: string;
  avatar_url?: string | null;
  userId?: string;
}

export interface StampEntry {
  id: string;
  title: string;
  iconCode: string;
  // 图片 URL：可为空 (http URL / Base64 / Supabase Storage 路径)，
  // 空值由卡片渲染渐变占位，严禁硬编码网络替代图
  photo: string | null;
  location: string;
  city: string;
  country: string;
  category: StampCategory;
  description: string;
  accent: string;
  creator: StampCreator;
  createdAt: string;
  note: string;
  isFeatured: boolean;
}

export const CITY_COUNTRY_MAP: Record<string, string> = {
  "jinjiang": "China",
  "jinjiang city": "China",
  "los angeles": "United States",
  "milan": "Italy",
  "rome": "Italy",
  "paris": "France",
  "london": "United Kingdom",
  "barcelona": "Spain",
  "berlin": "Germany",
  "tokyo": "Japan",
  "kyoto": "Japan",
  "singapore": "Singapore",
  "hong kong": "China",
  "shanghai": "China",
  "beijing": "China",
  "hangzhou": "China",
  "chengdu": "China",
  "xiamen": "China",
  "shenzhen": "China",
  "guangzhou": "China",
  "dubai": "UAE",
  "new york": "United States",
  "san francisco": "United States",
  "chicago": "United States",
  "miami": "United States",
  "sydney": "Australia",
  "melbourne": "Australia",
  "auckland": "New Zealand",
  "vancouver": "Canada",
  "toronto": "Canada",
  "montreal": "Canada",
  "mexico city": "Mexico",
  "cairo": "Egypt",
  "cape town": "South Africa",
  "sao paulo": "Brazil",
  "buenos aires": "Argentina",
  "lima": "Peru",
  "mumbai": "India",
  "delhi": "India",
  "bangkok": "Thailand",
  "phuket": "Thailand",
  "hanoi": "Vietnam",
  "ho chi minh": "Vietnam",
  "manila": "Philippines",
  "jakarta": "Indonesia",
  "kuala lumpur": "Malaysia",
  "seoul": "South Korea",
  "busan": "South Korea",
  "taipei": "Taiwan",
  "macau": "China",
  "copenhagen": "Denmark",
  "stockholm": "Sweden",
  "oslo": "Norway",
  "helsinki": "Finland",
  "amsterdam": "Netherlands",
  "brussels": "Belgium",
  "vienna": "Austria",
  "zurich": "Switzerland",
  "athens": "Greece",
  "lisbon": "Portugal",
  "madrid": "Spain",
  "moscow": "Russia",
  "prague": "Czech Republic",
  "budapest": "Hungary",
  "warsaw": "Poland",
  "dublin": "Ireland",
  "edinburgh": "United Kingdom",
  "amalfi": "Italy",
  "venice": "Italy",
  "florence": "Italy",
  "naples": "Italy",
  "nice": "France",
  "marseille": "France",
  "cannes": "France",
  "hamburg": "Germany",
  "munich": "Germany",
  "düsseldorf": "Germany",
};

export function getEffectiveCountry(city: string, country?: string): string {
  if (country && country.trim()) return country.trim();
  // 优先通过全局字典由城市反推标准英文国名（中文/英文/别名城市名均支持，
  // 如 "贝加莫" / "Bergamo" / "roma" → "Italy"）
  const countryEntry = getCountryEntryByCity(city || "");
  if (countryEntry) return countryEntry.en;
  const lowerCity = city.toLowerCase();
  return CITY_COUNTRY_MAP[lowerCity] || CITY_COUNTRY_MAP[lowerCity.replace(/ city$/, "")] || "Other";
}

// ─────────────────────────────────────────────────────────────────────────
// 地理名称本地化映射（英文 → 中文）
// 用于足迹/百科模块在国家/城市标签上的多语言显示
// ─────────────────────────────────────────────────────────────────────────

const COUNTRY_CN_MAP: Record<string, string> = {
  "china": "中国",
  "united states": "美国",
  "usa": "美国",
  "italy": "意大利",
  "france": "法国",
  "united kingdom": "英国",
  "uk": "英国",
  "spain": "西班牙",
  "germany": "德国",
  "japan": "日本",
  "singapore": "新加坡",
  "uae": "阿联酋",
  "australia": "澳大利亚",
  "new zealand": "新西兰",
  "canada": "加拿大",
  "mexico": "墨西哥",
  "egypt": "埃及",
  "south africa": "南非",
  "brazil": "巴西",
  "argentina": "阿根廷",
  "peru": "秘鲁",
  "india": "印度",
  "thailand": "泰国",
  "vietnam": "越南",
  "philippines": "菲律宾",
  "indonesia": "印度尼西亚",
  "malaysia": "马来西亚",
  "south korea": "韩国",
  "taiwan": "台湾",
  "denmark": "丹麦",
  "sweden": "瑞典",
  "norway": "挪威",
  "finland": "芬兰",
  "netherlands": "荷兰",
  "belgium": "比利时",
  "austria": "奥地利",
  "switzerland": "瑞士",
  "greece": "希腊",
  "portugal": "葡萄牙",
  "russia": "俄罗斯",
  "czech republic": "捷克",
  "hungary": "匈牙利",
  "poland": "波兰",
  "ireland": "爱尔兰",
};

const CITY_CN_MAP: Record<string, string> = {
  "jinjiang": "晋江市",
  "jinjiang city": "晋江市",
  "los angeles": "洛杉矶",
  "milan": "米兰",
  "rome": "罗马",
  "paris": "巴黎",
  "london": "伦敦",
  "barcelona": "巴塞罗那",
  "berlin": "柏林",
  "tokyo": "东京",
  "kyoto": "京都",
  "singapore": "新加坡",
  "hong kong": "香港",
  "shanghai": "上海",
  "beijing": "北京",
  "hangzhou": "杭州",
  "chengdu": "成都",
  "xiamen": "厦门",
  "shenzhen": "深圳",
  "guangzhou": "广州",
  "dubai": "迪拜",
  "new york": "纽约",
  "san francisco": "旧金山",
  "chicago": "芝加哥",
  "miami": "迈阿密",
  "sydney": "悉尼",
  "melbourne": "墨尔本",
  "auckland": "奥克兰",
  "vancouver": "温哥华",
  "toronto": "多伦多",
  "montreal": "蒙特利尔",
  "mexico city": "墨西哥城",
  "cairo": "开罗",
  "cape town": "开普敦",
  "sao paulo": "圣保罗",
  "buenos aires": "布宜诺斯艾利斯",
  "lima": "利马",
  "mumbai": "孟买",
  "delhi": "德里",
  "bangkok": "曼谷",
  "phuket": "普吉岛",
  "hanoi": "河内",
  "ho chi minh": "胡志明市",
  "manila": "马尼拉",
  "jakarta": "雅加达",
  "kuala lumpur": "吉隆坡",
  "seoul": "首尔",
  "busan": "釜山",
  "taipei": "台北",
  "macau": "澳门",
  "copenhagen": "哥本哈根",
  "stockholm": "斯德哥尔摩",
  "oslo": "奥斯陆",
  "helsinki": "赫尔辛基",
  "amsterdam": "阿姆斯特丹",
  "brussels": "布鲁塞尔",
  "vienna": "维也纳",
  "zurich": "苏黎世",
  "athens": "雅典",
  "lisbon": "里斯本",
  "madrid": "马德里",
  "moscow": "莫斯科",
  "prague": "布拉格",
  "budapest": "布达佩斯",
  "warsaw": "华沙",
  "dublin": "都柏林",
  "edinburgh": "爱丁堡",
  "amalfi": "阿马尔菲",
  "venice": "威尼斯",
  "florence": "佛罗伦萨",
  "naples": "那不勒斯",
  "nice": "尼斯",
  "marseille": "马赛",
  "cannes": "戛纳",
  "hamburg": "汉堡",
  "munich": "慕尼黑",
  "düsseldorf": "杜塞尔多夫",
};

/**
 * 根据当前语言本地化地理名称
 * - locale === "en" 时原样返回英文
 * - locale === "zh" 时查映射表返回中文，未命中则原样返回
 * - 优先咨询 geo-i18n 权威字典：繁体（米蘭）/本地拼写（Milano）统一映射标准名
 */
export function getLocalizedLocation(
  value: string,
  locale: string,
): string {
  if (locale === "en" || !value) return value;
  const geoHit = lookupCityEntry(value);
  if (geoHit) return geoHit.zh;
  const lower = value.toLowerCase().trim();
  return CITY_CN_MAP[lower] || COUNTRY_CN_MAP[lower] || value;
}

/**
 * 本地化城市+国家组合显示
 * 中文模式下返回 "城市, 国家"（均为中文），英文模式原样返回
 */
export function getLocalizedLocationText(
  city: string,
  country: string,
  locale: string,
): string {
  const c = getLocalizedLocation(city, locale);
  const co = getLocalizedLocation(country, locale);
  return `${c}, ${co}`;
}

export const CATEGORY_ICON_MAP: Record<string, string> = {
  cities: "1f3db",
  nature: "1f33f",
  food: "1f35c",
  attraction: "1f3af",
  default: "1f30d",
};

export const CATEGORY_ACCENT_MAP: Record<string, string> = {
  cities: "from-cyan-400/40 to-teal-500/10",
  nature: "from-emerald-400/40 to-cyan-500/10",
  food: "from-amber-400/40 to-red-500/10",
  attraction: "from-violet-400/40 to-pink-500/10",
  default: "from-slate-400/40 to-cyan-500/10",
};

export function mapCheckinCategory(cat: string | null): StampCategory {
  if (cat === "cities" || cat === "nature" || cat === "food") return cat;
  if (cat === "attraction") return "cities";
  return "cities";
}

export function getCategoryIcon(cat: string | null): string {
  return CATEGORY_ICON_MAP[cat || "default"] || CATEGORY_ICON_MAP.default;
}

export const CATEGORY_STYLE_MAP: Record<string, { icon: string; border: string; shadow: string; bg: string; color: string }> = {
  cities: { icon: "1f3db", border: "border-brand", shadow: "shadow-[0_0_12px_rgba(13,148,136,0.4)]", bg: "bg-muted", color: "#0D9488" },
  nature: { icon: "1f33f", border: "border-[#10B981]", shadow: "shadow-[0_0_12px_rgba(16,185,129,0.4)]", bg: "bg-[#1E2A22]", color: "#10B981" },
  food: { icon: "1f35c", border: "border-[#F59E0B]", shadow: "shadow-[0_0_12px_rgba(245,158,11,0.4)]", bg: "bg-[#2A2318]", color: "#F59E0B" },
  attraction: { icon: "1f3db", border: "border-brand", shadow: "shadow-[0_0_12px_rgba(13,148,136,0.4)]", bg: "bg-muted", color: "#0D9488" },
  default: { icon: "1f30d", border: "border-brand", shadow: "shadow-[0_0_12px_rgba(13,148,136,0.4)]", bg: "bg-muted", color: "#0D9488" },
};

export function getCategoryStyle(cat: string | null | undefined) {
  const key = cat || "default";
  return CATEGORY_STYLE_MAP[key] || CATEGORY_STYLE_MAP.default;
}

export function getCategoryAccent(cat: string | null): string {
  return CATEGORY_ACCENT_MAP[cat || "default"] || CATEGORY_ACCENT_MAP.default;
}

export function twemojiUrl(code: string) {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`;
}

export function stringToColor(str: string): string {
  const colors = [
    "bg-cyan-500",
    "bg-rose-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-sky-500",
    "bg-orange-500",
    "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

/**
 * 统一地址解析工具：从完整地址中提取城市和国家，去除邮政编码和街道号。
 * 固定格式输出：`[City], [Country]`
 *
 * 优先解析 Nominatim address 对象（结构化字段），无结构化数据时回退到字符串解析。
 * 严格排除 State/Province/Region 层级。
 *
 * 示例：
 * - "West 6th Street, Westlake South, Los Angeles, 90017, California, United States"
 *   → "Los Angeles, United States"
 */
export function formatLocation(fullAddress: string): { city: string; country: string; display: string } {
  try {
    const parts = fullAddress.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    let city = "";
    let country = "";

    // 反向遍历：最后一段通常是 country，倒数第二或第三段是 city
    // 严格跳过：邮编、纯数字开头、State/Province/Region
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      const normalized = part.toLowerCase();

      // 跳过邮编和数字开头的片段
      if (/^\d{4,6}$/.test(part)) continue;
      if (/^\d+/.test(part)) continue;

      // 跳过 State/Province/Region 层级
      if (normalized.includes("state") || normalized.includes("province") || normalized.includes("region")) continue;

      if (!country) {
        country = part;
      } else if (!city) {
        city = part;
      }
    }

    // 如果只有城市没有国家，尝试从原始地址中提取国家
    if (city && !country) {
      const countryPatterns = [
        "united states", "usa", "america",
        "china", "people's republic of china",
        "japan", "nippon",
        "italy", "italia",
        "france", "française",
        "uk", "united kingdom", "great britain",
        "germany", "deutschland",
        "spain", "españa",
        "portugal",
        "australia",
        "canada",
        "mexico",
        "brazil",
        "india",
        "russia", "russian federation",
        "korea", "south korea", "republic of korea",
        "thailand",
        "vietnam",
        "singapore",
        "malaysia",
        "indonesia",
        "philippines",
        "new zealand",
        "switzerland",
        "austria",
        "netherlands",
        "belgium",
        "denmark",
        "norway",
        "sweden",
        "finland",
        "poland",
        "czech", "czechia",
        "hungary",
        "greece",
        "turkey",
        "israel",
        "uae", "united arab emirates",
        "saudi arabia",
        "egypt",
        "south africa",
        "argentina",
        "chile",
        "peru",
        "colombia",
        "venezuela",
        "costa rica",
        "panama",
        "cuba",
      ];

      const lowerFull = fullAddress.toLowerCase();
      for (const pattern of countryPatterns) {
        if (lowerFull.includes(pattern)) {
          // 返回标准国家名称
          const standardNames: Record<string, string> = {
            "united states": "United States",
            "usa": "United States",
            "america": "United States",
            "china": "China",
            "people's republic of china": "China",
            "japan": "Japan",
            "nippon": "Japan",
            "italy": "Italy",
            "italia": "Italy",
            "france": "France",
            "française": "France",
            "uk": "United Kingdom",
            "united kingdom": "United Kingdom",
            "great britain": "United Kingdom",
            "germany": "Germany",
            "deutschland": "Germany",
            "spain": "Spain",
            "españa": "Spain",
            "portugal": "Portugal",
            "australia": "Australia",
            "canada": "Canada",
            "mexico": "Mexico",
            "brazil": "Brazil",
            "india": "India",
            "russia": "Russia",
            "russian federation": "Russia",
            "korea": "South Korea",
            "south korea": "South Korea",
            "republic of korea": "South Korea",
            "thailand": "Thailand",
            "vietnam": "Vietnam",
            "singapore": "Singapore",
            "malaysia": "Malaysia",
            "indonesia": "Indonesia",
            "philippines": "Philippines",
            "new zealand": "New Zealand",
            "switzerland": "Switzerland",
            "austria": "Austria",
            "netherlands": "Netherlands",
            "belgium": "Belgium",
            "denmark": "Denmark",
            "norway": "Norway",
            "sweden": "Sweden",
            "finland": "Finland",
            "poland": "Poland",
            "czech": "Czech Republic",
            "czechia": "Czech Republic",
            "hungary": "Hungary",
            "greece": "Greece",
            "turkey": "Turkey",
            "israel": "Israel",
            "uae": "UAE",
            "united arab emirates": "UAE",
            "saudi arabia": "Saudi Arabia",
            "egypt": "Egypt",
            "south africa": "South Africa",
            "argentina": "Argentina",
            "chile": "Chile",
            "peru": "Peru",
            "colombia": "Colombia",
            "venezuela": "Venezuela",
            "costa rica": "Costa Rica",
            "panama": "Panama",
            "cuba": "Cuba",
          };
          country = standardNames[pattern] || pattern.charAt(0).toUpperCase() + pattern.slice(1);
          break;
        }
      }
    }

    const display = city && country ? `${city}, ${country}` : city || country || fullAddress;
    return { city: city || "", country, display };
  } catch {
    return { city: "", country: "", display: fullAddress };
  }
}

/**
 * 清洗 Nominatim 返回的原始地名片段：
 * - 部分地区的 address 字段会返回分号拼接的多语言重复名（如 "洛杉矶;洛杉矶" / "美国;美国"），
 *   直接拼接展示会出现 "洛杉矶;洛杉矶, 美国;美国" 这类脏数据；
 * - 统一按分号（半角 ; / 全角 ；）切割取第一段并 trim，确保输出干净的单一名称。
 */
export function cleanLocationPart(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.split(/[;；]/)[0].trim();
}

/**
 * 从 Nominatim reverse geocoding 返回的 JSON 中精准提取 city 和 country。
 * 优先使用结构化 address 对象，避免从 display_name 字符串中猜测。
 *
 * address 对象字段优先级（城市层级）：
 * city > town > village > municipality > county > hamlet
 * 严格不提取 state / province / region。
 */
export function extractFromNominatim(data: {
  display_name?: string;
  address?: Record<string, string | undefined>;
}): { full: string; city: string; country: string; display: string } {
  const full = data.display_name || "Unknown Location";
  const addr = data.address || {};

  // 国家：优先使用 address.country（清洗分号重复名）
  const country = cleanLocationPart(addr.country);

  // 城市：按优先级取第一个存在的字段（同样清洗分号重复名）
  const city = cleanLocationPart(
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    addr.hamlet ||
    addr.suburb ||
    "",
  );

  // 如果结构化字段齐全，直接组合
  if (city && country) {
    return { full, city, country, display: `${city}, ${country}` };
  }

  // 回退：从 display_name 解析
  const fallback = formatLocation(full);
  const fallbackCity = city || cleanLocationPart(fallback.city);
  const fallbackCountry = country || cleanLocationPart(fallback.country);
  return {
    full,
    city: fallbackCity,
    country: fallbackCountry,
    display: fallbackCity && fallbackCountry
      ? `${fallbackCity}, ${fallbackCountry}`
      : fallback.display,
  };
}
