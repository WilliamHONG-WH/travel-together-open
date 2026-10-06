/**
 * 全球主流国家与城市标准化字典
 * ─────────────────────────────────────────────────────────────────────────
 * 设计目标：
 * 1. 通过稳定的 `key`（标准化 ID）作为数据库存储与跨语言联动的唯一索引；
 * 2. 提供 `getLocalizedLocationName(key, locale)` 通用解析函数，全站三端联动：
 *    导航栏筛选 / 卡片外部角落标签 / 卡片内部详情统一调用；
 * 3. 未命中字典的自定义偏门地名会智能格式化返回，确保全站无死角覆盖。
 *
 * 数据结构：每个国家包含 { key, zh, en, cities: [{ key, zh, en }] }
 * city.key 在同一国家内唯一；全局通过 `${countryKey}:${cityKey}` 复合索引查找。
 */

export type Locale = "zh" | "en";

export interface CityEntry {
  key: string;
  zh: string;
  en: string;
}

export interface CountryEntry {
  key: string;
  zh: string;
  en: string;
  cities: CityEntry[];
}

/** 全球主流国家与城市映射（欧洲 / 亚洲 / 美洲 / 大洋洲 / 中东 / 非洲） */
export const GLOBAL_LOCATIONS: CountryEntry[] = [
  {
    key: "france",
    zh: "法国",
    en: "France",
    cities: [
      { key: "paris", zh: "巴黎", en: "Paris" },
      { key: "nice", zh: "尼斯", en: "Nice" },
      { key: "lyon", zh: "里昂", en: "Lyon" },
      { key: "marseille", zh: "马赛", en: "Marseille" },
      { key: "cannes", zh: "戛纳", en: "Cannes" },
      { key: "bordeaux", zh: "波尔多", en: "Bordeaux" },
      { key: "strasbourg", zh: "斯特拉斯堡", en: "Strasbourg" },
    ],
  },
  {
    key: "uk",
    zh: "英国",
    en: "United Kingdom",
    cities: [
      { key: "london", zh: "伦敦", en: "London" },
      { key: "edinburgh", zh: "爱丁堡", en: "Edinburgh" },
      { key: "manchester", zh: "曼彻斯特", en: "Manchester" },
      { key: "cambridge", zh: "剑桥", en: "Cambridge" },
      { key: "oxford", zh: "牛津", en: "Oxford" },
      { key: "liverpool", zh: "利物浦", en: "Liverpool" },
      { key: "bath", zh: "巴斯", en: "Bath" },
    ],
  },
  {
    key: "italy",
    zh: "意大利",
    en: "Italy",
    cities: [
      { key: "rome", zh: "罗马", en: "Rome" },
      { key: "milan", zh: "米兰", en: "Milan" },
      { key: "venice", zh: "威尼斯", en: "Venice" },
      { key: "florence", zh: "佛罗伦萨", en: "Florence" },
      { key: "naples", zh: "那不勒斯", en: "Naples" },
      { key: "amalfi", zh: "阿马尔菲", en: "Amalfi" },
      { key: "pisa", zh: "比萨", en: "Pisa" },
      { key: "sicily", zh: "西西里", en: "Sicily" },
      { key: "bergamo", zh: "贝加莫", en: "Bergamo" },
      { key: "turin", zh: "都灵", en: "Turin" },
      { key: "bologna", zh: "博洛尼亚", en: "Bologna" },
      { key: "verona", zh: "维罗纳", en: "Verona" },
      { key: "genoa", zh: "热那亚", en: "Genoa" },
      { key: "padua", zh: "帕多瓦", en: "Padua" },
      { key: "siena", zh: "锡耶纳", en: "Siena" },
      { key: "cinque_terre", zh: "五渔村", en: "Cinque Terre" },
      { key: "como", zh: "科莫", en: "Como" },
      { key: "lake_como", zh: "科莫湖", en: "Lake Como" },
      { key: "sorrento", zh: "索伦托", en: "Sorrento" },
      { key: "positano", zh: "波西塔诺", en: "Positano" },
      { key: "pompeii", zh: "庞贝", en: "Pompeii" },
      { key: "san_gimignano", zh: "圣吉米尼亚诺", en: "San Gimignano" },
      { key: "palermo", zh: "巴勒莫", en: "Palermo" },
      { key: "catania", zh: "卡塔尼亚", en: "Catania" },
      { key: "matera", zh: "马泰拉", en: "Matera" },
      { key: "ravenna", zh: "拉文纳", en: "Ravenna" },
      { key: "vicenza", zh: "维琴察", en: "Vicenza" },
      { key: "treviso", zh: "特雷维索", en: "Treviso" },
    ],
  },
  {
    key: "vatican_city",
    zh: "梵蒂冈",
    en: "Vatican City",
    cities: [{ key: "vatican_city", zh: "梵蒂冈城", en: "Vatican City" }],
  },
  {
    key: "spain",
    zh: "西班牙",
    en: "Spain",
    cities: [
      { key: "madrid", zh: "马德里", en: "Madrid" },
      { key: "barcelona", zh: "巴塞罗那", en: "Barcelona" },
      { key: "seville", zh: "塞维利亚", en: "Seville" },
      { key: "valencia", zh: "瓦伦西亚", en: "Valencia" },
      { key: "granada", zh: "格拉纳达", en: "Granada" },
      { key: "ibiza", zh: "伊维萨", en: "Ibiza" },
    ],
  },
  {
    key: "germany",
    zh: "德国",
    en: "Germany",
    cities: [
      { key: "berlin", zh: "柏林", en: "Berlin" },
      { key: "munich", zh: "慕尼黑", en: "Munich" },
      { key: "hamburg", zh: "汉堡", en: "Hamburg" },
      { key: "frankfurt", zh: "法兰克福", en: "Frankfurt" },
      { key: "cologne", zh: "科隆", en: "Cologne" },
      { key: "dusseldorf", zh: "杜塞尔多夫", en: "Düsseldorf" },
    ],
  },
  {
    key: "netherlands",
    zh: "荷兰",
    en: "Netherlands",
    cities: [
      { key: "amsterdam", zh: "阿姆斯特丹", en: "Amsterdam" },
      { key: "rotterdam", zh: "鹿特丹", en: "Rotterdam" },
      { key: "the_hague", zh: "海牙", en: "The Hague" },
    ],
  },
  {
    key: "belgium",
    zh: "比利时",
    en: "Belgium",
    cities: [
      { key: "brussels", zh: "布鲁塞尔", en: "Brussels" },
      { key: "bruges", zh: "布鲁日", en: "Bruges" },
      { key: "antwerp", zh: "安特卫普", en: "Antwerp" },
    ],
  },
  {
    key: "austria",
    zh: "奥地利",
    en: "Austria",
    cities: [
      { key: "vienna", zh: "维也纳", en: "Vienna" },
      { key: "salzburg", zh: "萨尔茨堡", en: "Salzburg" },
      { key: "innsbruck", zh: "因斯布鲁克", en: "Innsbruck" },
    ],
  },
  {
    key: "switzerland",
    zh: "瑞士",
    en: "Switzerland",
    cities: [
      { key: "zurich", zh: "苏黎世", en: "Zurich" },
      { key: "geneva", zh: "日内瓦", en: "Geneva" },
      { key: "lucerne", zh: "卢塞恩", en: "Lucerne" },
      { key: "interlaken", zh: "因特拉肯", en: "Interlaken" },
    ],
  },
  {
    key: "greece",
    zh: "希腊",
    en: "Greece",
    cities: [
      { key: "athens", zh: "雅典", en: "Athens" },
      { key: "santorini", zh: "圣托里尼", en: "Santorini" },
      { key: "mykonos", zh: "米科诺斯", en: "Mykonos" },
      { key: "thessaloniki", zh: "塞萨洛尼基", en: "Thessaloniki" },
    ],
  },
  {
    key: "portugal",
    zh: "葡萄牙",
    en: "Portugal",
    cities: [
      { key: "lisbon", zh: "里斯本", en: "Lisbon" },
      { key: "porto", zh: "波尔图", en: "Porto" },
      { key: "faro", zh: "法鲁", en: "Faro" },
    ],
  },
  {
    key: "russia",
    zh: "俄罗斯",
    en: "Russia",
    cities: [
      { key: "moscow", zh: "莫斯科", en: "Moscow" },
      { key: "saint_petersburg", zh: "圣彼得堡", en: "Saint Petersburg" },
    ],
  },
  {
    key: "czech",
    zh: "捷克",
    en: "Czech Republic",
    cities: [
      { key: "prague", zh: "布拉格", en: "Prague" },
      { key: "cesky_krumlov", zh: "克鲁姆洛夫", en: "Český Krumlov" },
    ],
  },
  {
    key: "hungary",
    zh: "匈牙利",
    en: "Hungary",
    cities: [{ key: "budapest", zh: "布达佩斯", en: "Budapest" }],
  },
  {
    key: "poland",
    zh: "波兰",
    en: "Poland",
    cities: [
      { key: "warsaw", zh: "华沙", en: "Warsaw" },
      { key: "krakow", zh: "克拉科夫", en: "Krakow" },
    ],
  },
  {
    key: "ireland",
    zh: "爱尔兰",
    en: "Ireland",
    cities: [{ key: "dublin", zh: "都柏林", en: "Dublin" }],
  },
  {
    key: "denmark",
    zh: "丹麦",
    en: "Denmark",
    cities: [{ key: "copenhagen", zh: "哥本哈根", en: "Copenhagen" }],
  },
  {
    key: "sweden",
    zh: "瑞典",
    en: "Sweden",
    cities: [
      { key: "stockholm", zh: "斯德哥尔摩", en: "Stockholm" },
      { key: "gothenburg", zh: "哥德堡", en: "Gothenburg" },
    ],
  },
  {
    key: "norway",
    zh: "挪威",
    en: "Norway",
    cities: [
      { key: "oslo", zh: "奥斯陆", en: "Oslo" },
      { key: "bergen", zh: "卑尔根", en: "Bergen" },
    ],
  },
  {
    key: "finland",
    zh: "芬兰",
    en: "Finland",
    cities: [{ key: "helsinki", zh: "赫尔辛基", en: "Helsinki" }],
  },
  {
    key: "iceland",
    zh: "冰岛",
    en: "Iceland",
    cities: [{ key: "reykjavik", zh: "雷克雅未克", en: "Reykjavik" }],
  },
  {
    key: "china",
    zh: "中国",
    en: "China",
    cities: [
      { key: "beijing", zh: "北京", en: "Beijing" },
      { key: "shanghai", zh: "上海", en: "Shanghai" },
      { key: "guangzhou", zh: "广州", en: "Guangzhou" },
      { key: "shenzhen", zh: "深圳", en: "Shenzhen" },
      { key: "chengdu", zh: "成都", en: "Chengdu" },
      { key: "hangzhou", zh: "杭州", en: "Hangzhou" },
      { key: "xiamen", zh: "厦门", en: "Xiamen" },
      { key: "jinjiang", zh: "晋江", en: "Jinjiang" },
      { key: "hong_kong", zh: "香港", en: "Hong Kong" },
      { key: "macau", zh: "澳门", en: "Macau" },
      { key: "taipei", zh: "台北", en: "Taipei" },
      { key: "xian", zh: "西安", en: "Xi'an" },
      { key: "chongqing", zh: "重庆", en: "Chongqing" },
      { key: "kunming", zh: "昆明", en: "Kunming" },
      { key: "lhasa", zh: "拉萨", en: "Lhasa" },
      { key: "urumqi", zh: "乌鲁木齐", en: "Urumqi" },
    ],
  },
  {
    key: "japan",
    zh: "日本",
    en: "Japan",
    cities: [
      { key: "tokyo", zh: "东京", en: "Tokyo" },
      { key: "kyoto", zh: "京都", en: "Kyoto" },
      { key: "osaka", zh: "大阪", en: "Osaka" },
      { key: "nagoya", zh: "名古屋", en: "Nagoya" },
      { key: "sapporo", zh: "札幌", en: "Sapporo" },
      { key: "fukuoka", zh: "福冈", en: "Fukuoka" },
      { key: "okinawa", zh: "冲绳", en: "Okinawa" },
      { key: "nara", zh: "奈良", en: "Nara" },
      { key: "hakone", zh: "箱根", en: "Hakone" },
    ],
  },
  {
    key: "south_korea",
    zh: "韩国",
    en: "South Korea",
    cities: [
      { key: "seoul", zh: "首尔", en: "Seoul" },
      { key: "busan", zh: "釜山", en: "Busan" },
      { key: "jeju", zh: "济州岛", en: "Jeju" },
      { key: "incheon", zh: "仁川", en: "Incheon" },
    ],
  },
  {
    key: "thailand",
    zh: "泰国",
    en: "Thailand",
    cities: [
      { key: "bangkok", zh: "曼谷", en: "Bangkok" },
      { key: "phuket", zh: "普吉岛", en: "Phuket" },
      { key: "chiang_mai", zh: "清迈", en: "Chiang Mai" },
      { key: "pattaya", zh: "芭提雅", en: "Pattaya" },
      { key: "koh_samui", zh: "苏梅岛", en: "Koh Samui" },
    ],
  },
  {
    key: "vietnam",
    zh: "越南",
    en: "Vietnam",
    cities: [
      { key: "hanoi", zh: "河内", en: "Hanoi" },
      { key: "ho_chi_minh", zh: "胡志明市", en: "Ho Chi Minh" },
      { key: "da_nang", zh: "岘港", en: "Da Nang" },
      { key: "hanoi_old_quarter", zh: "河内老城区", en: "Hanoi Old Quarter" },
    ],
  },
  {
    key: "singapore",
    zh: "新加坡",
    en: "Singapore",
    cities: [{ key: "singapore", zh: "新加坡", en: "Singapore" }],
  },
  {
    key: "malaysia",
    zh: "马来西亚",
    en: "Malaysia",
    cities: [
      { key: "kuala_lumpur", zh: "吉隆坡", en: "Kuala Lumpur" },
      { key: "penang", zh: "槟城", en: "Penang" },
      { key: "kota_kinabalu", zh: "哥打京那巴鲁", en: "Kota Kinabalu" },
    ],
  },
  {
    key: "indonesia",
    zh: "印度尼西亚",
    en: "Indonesia",
    cities: [
      { key: "bali", zh: "巴厘岛", en: "Bali" },
      { key: "jakarta", zh: "雅加达", en: "Jakarta" },
      { key: "yogyakarta", zh: "日惹", en: "Yogyakarta" },
    ],
  },
  {
    key: "philippines",
    zh: "菲律宾",
    en: "Philippines",
    cities: [
      { key: "manila", zh: "马尼拉", en: "Manila" },
      { key: "cebu", zh: "宿务", en: "Cebu" },
      { key: "boracay", zh: "长滩岛", en: "Boracay" },
    ],
  },
  {
    key: "india",
    zh: "印度",
    en: "India",
    cities: [
      { key: "mumbai", zh: "孟买", en: "Mumbai" },
      { key: "delhi", zh: "德里", en: "Delhi" },
      { key: "agra", zh: "阿格拉", en: "Agra" },
      { key: "jaipur", zh: "斋普尔", en: "Jaipur" },
      { key: "varanasi", zh: "瓦拉纳西", en: "Varanasi" },
    ],
  },
  {
    key: "cambodia",
    zh: "柬埔寨",
    en: "Cambodia",
    cities: [
      { key: "siem_reap", zh: "暹粒", en: "Siem Reap" },
      { key: "phnom_penh", zh: "金边", en: "Phnom Penh" },
    ],
  },
  {
    key: "usa",
    zh: "美国",
    en: "United States",
    cities: [
      { key: "new_york", zh: "纽约", en: "New York" },
      { key: "los_angeles", zh: "洛杉矶", en: "Los Angeles" },
      { key: "san_francisco", zh: "旧金山", en: "San Francisco" },
      { key: "chicago", zh: "芝加哥", en: "Chicago" },
      { key: "miami", zh: "迈阿密", en: "Miami" },
      { key: "boston", zh: "波士顿", en: "Boston" },
      { key: "seattle", zh: "西雅图", en: "Seattle" },
      { key: "las_vegas", zh: "拉斯维加斯", en: "Las Vegas" },
      { key: "washington_dc", zh: "华盛顿", en: "Washington D.C." },
      { key: "hawaii", zh: "夏威夷", en: "Hawaii" },
      { key: "yosemite", zh: "优胜美地", en: "Yosemite" },
    ],
  },
  {
    key: "canada",
    zh: "加拿大",
    en: "Canada",
    cities: [
      { key: "vancouver", zh: "温哥华", en: "Vancouver" },
      { key: "toronto", zh: "多伦多", en: "Toronto" },
      { key: "montreal", zh: "蒙特利尔", en: "Montreal" },
      { key: "banff", zh: "班夫", en: "Banff" },
      { key: "quebec_city", zh: "魁北克城", en: "Quebec City" },
    ],
  },
  {
    key: "mexico",
    zh: "墨西哥",
    en: "Mexico",
    cities: [
      { key: "mexico_city", zh: "墨西哥城", en: "Mexico City" },
      { key: "cancun", zh: "坎昆", en: "Cancun" },
      { key: "oaxaca", zh: "瓦哈卡", en: "Oaxaca" },
    ],
  },
  {
    key: "brazil",
    zh: "巴西",
    en: "Brazil",
    cities: [
      { key: "rio_de_janeiro", zh: "里约热内卢", en: "Rio de Janeiro" },
      { key: "sao_paulo", zh: "圣保罗", en: "São Paulo" },
      { key: "salvador", zh: "萨尔瓦多", en: "Salvador" },
    ],
  },
  {
    key: "argentina",
    zh: "阿根廷",
    en: "Argentina",
    cities: [
      { key: "buenos_aires", zh: "布宜诺斯艾利斯", en: "Buenos Aires" },
      { key: "mendoza", zh: "门多萨", en: "Mendoza" },
    ],
  },
  {
    key: "peru",
    zh: "秘鲁",
    en: "Peru",
    cities: [
      { key: "lima", zh: "利马", en: "Lima" },
      { key: "cusco", zh: "库斯科", en: "Cusco" },
      { key: "machu_picchu", zh: "马丘比丘", en: "Machu Picchu" },
    ],
  },
  {
    key: "chile",
    zh: "智利",
    en: "Chile",
    cities: [
      { key: "santiago", zh: "圣地亚哥", en: "Santiago" },
      { key: "easter_island", zh: "复活节岛", en: "Easter Island" },
    ],
  },
  {
    key: "australia",
    zh: "澳大利亚",
    en: "Australia",
    cities: [
      { key: "sydney", zh: "悉尼", en: "Sydney" },
      { key: "melbourne", zh: "墨尔本", en: "Melbourne" },
      { key: "brisbane", zh: "布里斯班", en: "Brisbane" },
      { key: "perth_au", zh: "珀斯", en: "Perth" },
      { key: "cairns", zh: "凯恩斯", en: "Cairns" },
      { key: "gold_coast", zh: "黄金海岸", en: "Gold Coast" },
    ],
  },
  {
    key: "new_zealand",
    zh: "新西兰",
    en: "New Zealand",
    cities: [
      { key: "auckland", zh: "奥克兰", en: "Auckland" },
      { key: "queenstown", zh: "皇后镇", en: "Queenstown" },
      { key: "wellington", zh: "惠灵顿", en: "Wellington" },
      { key: "christchurch", zh: "基督城", en: "Christchurch" },
    ],
  },
  {
    key: "uae",
    zh: "阿联酋",
    en: "United Arab Emirates",
    cities: [
      { key: "dubai", zh: "迪拜", en: "Dubai" },
      { key: "abu_dhabi", zh: "阿布扎比", en: "Abu Dhabi" },
    ],
  },
  {
    key: "saudi_arabia",
    zh: "沙特阿拉伯",
    en: "Saudi Arabia",
    cities: [
      { key: "riyadh", zh: "利雅得", en: "Riyadh" },
      { key: "jeddah", zh: "吉达", en: "Jeddah" },
    ],
  },
  {
    key: "israel",
    zh: "以色列",
    en: "Israel",
    cities: [
      { key: "jerusalem", zh: "耶路撒冷", en: "Jerusalem" },
      { key: "tel_aviv", zh: "特拉维夫", en: "Tel Aviv" },
    ],
  },
  {
    key: "turkey",
    zh: "土耳其",
    en: "Turkey",
    cities: [
      { key: "istanbul", zh: "伊斯坦布尔", en: "Istanbul" },
      { key: "cappadocia", zh: "卡帕多西亚", en: "Cappadocia" },
      { key: "ankara", zh: "安卡拉", en: "Ankara" },
    ],
  },
  {
    key: "egypt",
    zh: "埃及",
    en: "Egypt",
    cities: [
      { key: "cairo", zh: "开罗", en: "Cairo" },
      { key: "luxor", zh: "卢克索", en: "Luxor" },
      { key: "aswan", zh: "阿斯旺", en: "Aswan" },
    ],
  },
  {
    key: "south_africa",
    zh: "南非",
    en: "South Africa",
    cities: [
      { key: "cape_town", zh: "开普敦", en: "Cape Town" },
      { key: "johannesburg", zh: "约翰内斯堡", en: "Johannesburg" },
    ],
  },
  {
    key: "morocco",
    zh: "摩洛哥",
    en: "Morocco",
    cities: [
      { key: "marrakech", zh: "马拉喀什", en: "Marrakech" },
      { key: "casablanca", zh: "卡萨布兰卡", en: "Casablanca" },
      { key: "fez", zh: "非斯", en: "Fez" },
    ],
  },
  {
    key: "kenya",
    zh: "肯尼亚",
    en: "Kenya",
    cities: [
      { key: "nairobi", zh: "内罗毕", en: "Nairobi" },
      { key: "masai_mara", zh: "马赛马拉", en: "Masai Mara" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// 别名字典：本地语言名 / 缩写 / 中文变体 → 标准 key
// 确保中英（及 Nominatim 本地语言）输入均能双向命中字典
// ─────────────────────────────────────────────────────────────────────────

/** 标准化索引 key：小写 + 空格转下划线（与 utils/location.ts 的 normalizedKey 对齐） */
function normIndexKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "_");
}

/** 国家别名（含缩写 / 本地语言名 / 中文全称变体）→ 标准 country key */
const COUNTRY_ALIASES: Record<string, string> = {
  // 梵蒂冈（中文全称「梵蒂冈城国」与英文简称 Vatican 均可命中）
  "vatican": "vatican_city",
  "holy see": "vatican_city",
  "vatican city state": "vatican_city",
  "梵蒂冈城国": "vatican_city",
  "梵蒂冈城": "vatican_city",
  // 美国 / 英国常见缩写与变体
  "us": "usa",
  "america": "usa",
  "united states of america": "usa",
  "u.s.a.": "usa",
  "u.k.": "uk",
  "great britain": "uk",
  "britain": "uk",
  "england": "uk",
  // 本地语言国名（Nominatim accept-language 未生效时的兜底）
  "holland": "netherlands",
  "deutschland": "germany",
  "españa": "spain",
  "espana": "spain",
  "italia": "italy",
  "frança": "france",
  "franca": "france",
  "türkiye": "turkey",
  "turkiye": "turkey",
  "czechia": "czech",
  "korea": "south_korea",
  "republic of korea": "south_korea",
};

/** 城市别名（意大利等本地语言名 / 常见英文变体）→ 国家 key + 城市 key */
const CITY_ALIASES: Record<string, { countryKey: string; cityKey: string }> = {
  // 意大利本地语言名（Nominatim 常见返回）
  "roma": { countryKey: "italy", cityKey: "rome" },
  "milano": { countryKey: "italy", cityKey: "milan" },
  "napoli": { countryKey: "italy", cityKey: "naples" },
  "firenze": { countryKey: "italy", cityKey: "florence" },
  "venezia": { countryKey: "italy", cityKey: "venice" },
  "torino": { countryKey: "italy", cityKey: "turin" },
  "genova": { countryKey: "italy", cityKey: "genoa" },
  "padova": { countryKey: "italy", cityKey: "padua" },
  "bergamo": { countryKey: "italy", cityKey: "bergamo" },
  "bologna": { countryKey: "italy", cityKey: "bologna" },
  "verona": { countryKey: "italy", cityKey: "verona" },
  // 欧洲其他本地语言名
  "wien": { countryKey: "austria", cityKey: "vienna" },
  "praha": { countryKey: "czech", cityKey: "prague" },
  "moskva": { countryKey: "russia", cityKey: "moscow" },
  "sevilla": { countryKey: "spain", cityKey: "seville" },
  "lisboa": { countryKey: "portugal", cityKey: "lisbon" },
  "koln": { countryKey: "germany", cityKey: "cologne" },
  "köln": { countryKey: "germany", cityKey: "cologne" },
  "münchen": { countryKey: "germany", cityKey: "munich" },
  "munchen": { countryKey: "germany", cityKey: "munich" },
  // 英文常见变体
  "new york city": { countryKey: "usa", cityKey: "new_york" },
  "nyc": { countryKey: "usa", cityKey: "new_york" },
  "washington dc": { countryKey: "usa", cityKey: "washington_dc" },
  "hongkong": { countryKey: "china", cityKey: "hong_kong" },
  // 梵蒂冈：中文全称作为城市名时也能命中
  "梵蒂冈城国": { countryKey: "vatican_city", cityKey: "vatican_city" },
  "梵蒂冈": { countryKey: "vatican_city", cityKey: "vatican_city" },
};

// ─────────────────────────────────────────────────────────────────────────
// 内部索引：通过 key 快速查找国家/城市，避免每次线性扫描
// ─────────────────────────────────────────────────────────────────────────

const COUNTRY_INDEX: Record<string, CountryEntry> = (() => {
  const map: Record<string, CountryEntry> = {};
  for (const c of GLOBAL_LOCATIONS) {
    map[c.key] = c;
    // 兼容英文/中文名作为别名索引（lowercase）
    map[c.en.toLowerCase()] = c;
    map[c.zh] = c;
  }
  // 注册国家别名（原始小写 + 下划线标准化两种形式，双向兼容空格/下划线查询）
  for (const [alias, targetKey] of Object.entries(COUNTRY_ALIASES)) {
    const target = map[targetKey];
    if (!target) continue;
    map[alias.toLowerCase()] = target;
    map[normIndexKey(alias)] = target;
  }
  return map;
})();

/**
 * 城市索引：countryKey + cityKey 复合查找
 * 同时建立全局城市索引，便于仅凭 cityKey 模糊定位
 */
const CITY_INDEX_BY_COUNTRY: Record<string, Record<string, CityEntry>> = (() => {
  const map: Record<string, Record<string, CityEntry>> = {};
  for (const c of GLOBAL_LOCATIONS) {
    const inner: Record<string, CityEntry> = {};
    for (const city of c.cities) {
      inner[city.key] = city;
      inner[city.en.toLowerCase()] = city;
      inner[city.zh] = city;
    }
    map[c.key] = inner;
  }
  // 注册城市别名到对应国家的内部索引（getLocalizedCity 携带 countryKey 时可命中）
  for (const [alias, { countryKey, cityKey }] of Object.entries(CITY_ALIASES)) {
    const inner = map[countryKey];
    const cityEntry = inner?.[cityKey];
    if (!inner || !cityEntry) continue;
    inner[alias.toLowerCase()] = cityEntry;
    inner[normIndexKey(alias)] = cityEntry;
  }
  return map;
})();

/** 全局城市扁平索引（cityKey / en / zh 任一可命中） */
const CITY_FLAT_INDEX: Record<string, { country: CountryEntry; city: CityEntry }> = (() => {
  const map: Record<string, { country: CountryEntry; city: CityEntry }> = {};
  for (const c of GLOBAL_LOCATIONS) {
    for (const city of c.cities) {
      map[city.key] = { country: c, city };
      map[city.en.toLowerCase()] = { country: c, city };
      map[city.zh] = { country: c, city };
    }
  }
  // 注册城市别名到全局扁平索引（中文/意大利语/变体 → 标准条目）
  for (const [alias, { countryKey, cityKey }] of Object.entries(CITY_ALIASES)) {
    const inner = CITY_INDEX_BY_COUNTRY[countryKey];
    const cityEntry = inner?.[cityKey];
    const countryEntry = COUNTRY_INDEX[countryKey];
    if (!cityEntry || !countryEntry) continue;
    map[alias.toLowerCase()] = { country: countryEntry, city: cityEntry };
    map[normIndexKey(alias)] = { country: countryEntry, city: cityEntry };
  }
  return map;
})();

// ─────────────────────────────────────────────────────────────────────────
// 对外解析函数
// ─────────────────────────────────────────────────────────────────────────

/**
 * 智能格式化未命中的偏门地名：
 * - 英文模式：原样返回（首字母大写处理）
 * - 中文模式：若包含中文字符，原样返回；否则按英文标题格式返回
 */
function formatUnknown(value: string, locale: Locale): string {
  if (!value) return "";
  if (locale === "en") return value;
  // 中文模式
  if (/[\u4e00-\u9fa5]/.test(value)) return value;
  // 不含中文，按英文标题格式返回
  return value.replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * 通用国家本地化函数
 * - 接收：标准 country_key（如 "france"）或国家英文名（如 "France"）或中文名（如 "法国"）
 * - 返回：对应语言的国名
 *
 * @param countryKey 国家 key 或名称
 * @param locale     当前语言
 */
export function getLocalizedCountry(
  countryKey: string,
  locale: Locale,
): string {
  if (!countryKey) return "";
  const lower = countryKey.toLowerCase().trim();
  const entry = COUNTRY_INDEX[lower] || COUNTRY_INDEX[countryKey.trim()];
  if (entry) return locale === "zh" ? entry.zh : entry.en;
  return formatUnknown(countryKey, locale);
}

/**
 * 通用城市本地化函数
 * - 接收：标准 city_key（如 "paris"）或城市英文名（如 "Paris"）或中文名（如 "巴黎"）
 * - 返回：对应语言的城市名
 *
 * @param cityKey    城市 key 或名称
 * @param locale     当前语言
 * @param countryKey 可选，提供时可加速精准定位
 */
export function getLocalizedCity(
  cityKey: string,
  locale: Locale,
  countryKey?: string,
): string {
  if (!cityKey) return "";
  const lower = cityKey.toLowerCase().trim();

  // 优先在国家范围内匹配
  if (countryKey) {
    const countryLower = countryKey.toLowerCase().trim();
    const countryEntry = COUNTRY_INDEX[countryLower] || COUNTRY_INDEX[countryKey.trim()];
    if (countryEntry) {
      const inner = CITY_INDEX_BY_COUNTRY[countryEntry.key];
      const cityEntry = inner[lower] || inner[cityKey.trim()];
      if (cityEntry) return locale === "zh" ? cityEntry.zh : cityEntry.en;
    }
  }

  // 退化为全局城市扁平索引
  const flat = CITY_FLAT_INDEX[lower] || CITY_FLAT_INDEX[cityKey.trim()];
  if (flat) return locale === "zh" ? flat.city.zh : flat.city.en;

  return formatUnknown(cityKey, locale);
}

/**
 * 全站通用本地化地名解析函数
 * 自动识别 key 类型（国家或城市）并返回对应语言的地名
 *
 * 调用示例：
 *   getLocalizedLocationName("paris", "zh")           → "巴黎"
 *   getLocalizedLocationName("paris", "en")           → "Paris"
 *   getLocalizedLocationName("france", "zh")          → "法国"
 *   getLocalizedLocationName("france", "en")          → "France"
 *
 * @param key    标准 key 或既有名称字符串
 * @param locale 当前语言 ("zh" | "en")
 */
export function getLocalizedLocationName(
  key: string,
  locale: Locale,
): string {
  if (!key) return "";

  const lower = key.toLowerCase().trim();

  // 1) 国家索引优先匹配
  const countryEntry = COUNTRY_INDEX[lower] || COUNTRY_INDEX[key.trim()];
  if (countryEntry) return locale === "zh" ? countryEntry.zh : countryEntry.en;

  // 2) 城市扁平索引匹配
  const cityEntry = CITY_FLAT_INDEX[lower] || CITY_FLAT_INDEX[key.trim()];
  if (cityEntry) return locale === "zh" ? cityEntry.city.zh : cityEntry.city.en;

  // 3) 未命中：智能格式化返回
  return formatUnknown(key, locale);
}

/**
 * 拼装 "城市 · 国家" 形式的本地化组合文案
 * - 中文模式：`巴黎 · 法国`
 * - 英文模式：`PARIS · FRANCE`（按用户偏好，英文以全大写呈现）
 */
export function getLocalizedLocationPair(
  cityKey: string,
  countryKey: string,
  locale: Locale,
): string {
  const city = getLocalizedCity(cityKey, locale, countryKey);
  const country = getLocalizedCountry(countryKey, locale);
  if (!city && !country) return "";
  if (!city) return country;
  if (!country) return city;
  return locale === "en"
    ? `${city.toUpperCase()} · ${country.toUpperCase()}`
    : `${city} · ${country}`;
}

/**
 * 反查工具：根据已存的字符串名称（旧数据兼容）尝试解析出标准 country_key
 * 用于历史数据迁移或外部输入回填
 */
export function resolveCountryKey(value: string): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  const entry = COUNTRY_INDEX[lower] || COUNTRY_INDEX[value.trim()];
  return entry ? entry.key : null;
}

/**
 * 反查工具：根据已存的字符串名称尝试解析出标准 city_key
 */
export function resolveCityKey(value: string, countryKey?: string): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();

  if (countryKey) {
    const countryLower = countryKey.toLowerCase().trim();
    const countryEntry = COUNTRY_INDEX[countryLower] || COUNTRY_INDEX[countryKey.trim()];
    if (countryEntry) {
      const inner = CITY_INDEX_BY_COUNTRY[countryEntry.key];
      const cityEntry = inner[lower] || inner[value.trim()];
      if (cityEntry) return cityEntry.key;
    }
  }

  const flat = CITY_FLAT_INDEX[lower] || CITY_FLAT_INDEX[value.trim()];
  return flat ? flat.city.key : null;
}

/**
 * 反查工具：根据城市名（中文/英文/key/别名均支持）推导其所属国家条目
 * 用于足迹模块在 country 字段缺失时由 city 推导标准英文国名
 */
export function getCountryEntryByCity(cityValue: string): CountryEntry | null {
  if (!cityValue) return null;
  const flat = CITY_FLAT_INDEX[cityValue.toLowerCase().trim()] || CITY_FLAT_INDEX[cityValue.trim()];
  return flat ? flat.country : null;
}

/** 获取所有国家列表（供 Picker 选择器使用） */
export function getAllCountries(): CountryEntry[] {
  return GLOBAL_LOCATIONS;
}

/** 获取指定国家下的城市列表 */
export function getCitiesByCountry(countryKey: string): CityEntry[] {
  const entry = COUNTRY_INDEX[countryKey.toLowerCase().trim()];
  return entry ? entry.cities : [];
}

/** 全局扁平城市列表（供无国家约束的搜索使用） */
export function getAllCities(): Array<CityEntry & { countryKey: string; countryZh: string; countryEn: string }> {
  const list: Array<CityEntry & { countryKey: string; countryZh: string; countryEn: string }> = [];
  for (const c of GLOBAL_LOCATIONS) {
    for (const city of c.cities) {
      list.push({ ...city, countryKey: c.key, countryZh: c.zh, countryEn: c.en });
    }
  }
  return list;
}
