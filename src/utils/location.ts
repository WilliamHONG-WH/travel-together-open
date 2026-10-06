/**
 * 通用地点本地化解析工具
 * ─────────────────────────────────────────────────────────────────────────
 * 设计目标：
 * 1. 兼容多种输入格式（标准 key、英文国名/城市名、中文名、大小写混用、含空格）；
 * 2. 当传入标准 key（如 "france" / "paris"）时优先在 GLOBAL_LOCATIONS 全局字典中精确匹配；
 * 3. 当传入英文名或中文名时也能命中字典（fallback 别名索引）；
 * 4. 当传入偏门地名（字典未收录）时降级返回原字符串，确保不出现空值；
 * 5. 与百科模块的 getLocalizedCountry / getLocalizedCity 共用同一份字典源。
 *
 * 调用示例：
 *   getLocalizedLocationName("paris", "zh")           → "巴黎"
 *   getLocalizedLocationName("Paris", "zh")           → "巴黎"
 *   getLocalizedLocationName("paris", "en")           → "Paris"
 *   getLocalizedLocationName("france", "zh")          → "法国"
 *   getLocalizedLocationName("United States", "zh")   → "美国"
 *   getLocalizedLocationName("milan", "zh")           → "米兰"
 *   getLocalizedLocationName("Milan", "en")           → "Milan"
 *   getLocalizedLocationName("pizza", "zh")           → "pizza"  (未命中降级)
 */

import {
  getLocalizedCountry,
  getLocalizedCity,
  resolveCountryKey,
  resolveCityKey,
  type Locale,
} from "@/constants/locations";
import { lookupCityEntry } from "@/lib/geo-i18n";

// ─────────────────────────────────────────────────────────────────────────
// 拼音/英文 → 中文 扩展字典
// 覆盖 GLOBAL_LOCATIONS 未收录的中国大陆常见城市/区县（含直辖市辖区）
// 用于兜底解析 Nominatim 返回的拼音地名（如 Hongqiao / Longyan City）
// ─────────────────────────────────────────────────────────────────────────
const PINYIN_CN_EXT_MAP: Record<string, string> = {
  // 上海辖区
  hongqiao: "虹桥", pudong: "浦东", minhang: "闵行", jiading: "嘉定",
  jingan: "静安", huangpu: "黄浦", xuhui: "徐汇", changning: "长宁",
  putuo: "普陀", hongkou: "虹口", yangpu: "杨浦", baoshan: "宝山",
  songjiang: "松江", qingpu: "青浦", fengxian: "奉贤", chongming: "崇明",
  jinshan: "金山",
  // 福建
  longyan: "龙岩", quanzhou: "泉州", fuzhou: "福州", putian: "莆田",
  zhangzhou: "漳州", ningde: "宁德", nanping: "南平", sanming: "三明",
  longhai: "龙海",
  // 江浙
  wuxi: "无锡", suzhou: "苏州", nanjing: "南京", changzhou: "常州",
  nantong: "南通", yangzhou: "扬州", taizhou: "泰州", yancheng: "盐城",
  huaian: "淮安", lianyungang: "连云港", xuzhou: "徐州", suqian: "宿迁",
  zhenjiang: "镇江", ningbo: "宁波", wenzhou: "温州", jiaxing: "嘉兴",
  huzhou: "湖州", shaoxing: "绍兴", jinhua: "金华", quzhou: "衢州",
  zhoushan: "舟山", lishui: "丽水",
  // 华北
  tianjin: "天津", shijiazhuang: "石家庄", tangshan: "唐山",
  qinhuangdao: "秦皇岛", handan: "邯郸", baoding: "保定",
  zhangjiakou: "张家口", chengde: "承德", cangzhou: "沧州", langfang: "廊坊",
  taiyuan: "太原", datong: "大同", yangquan: "阳泉", changzhi: "长治",
  jincheng: "晋城", shuozhou: "朔州", jinzhong: "晋中", yuncheng: "运城",
  xinzhou: "忻州", linfen: "临汾", hohhot: "呼和浩特", baotou: "包头",
  wuhai: "乌海", chifeng: "赤峰", tongliao: "通辽", ordos: "鄂尔多斯",
  hulunbuir: "呼伦贝尔",
  // 东北
  shenyang: "沈阳", dalian: "大连", anshan: "鞍山", fushun: "抚顺",
  benxi: "本溪", dandong: "丹东", jinzhou: "锦州", yingkou: "营口",
  fuxin: "阜新", liaoyang: "辽阳", panjin: "盘锦", tieling: "铁岭",
  chaoyang: "朝阳", huludao: "葫芦岛", changchun: "长春", siping: "四平",
  liaoyuan: "辽源", tonghua: "通化", baishan: "白山", songyuan: "松原",
  baicheng: "白城", harbin: "哈尔滨", qiqihar: "齐齐哈尔", jixi: "鸡西",
  hegang: "鹤岗", shuangyashan: "双鸭山", daqing: "大庆", yichun: "伊春",
  jiamusi: "佳木斯", mudanjiang: "牡丹江", heihe: "黑河",
  // 华中
  wuhan: "武汉", huangshi: "黄石", shiyan: "十堰", yichang: "宜昌",
  xiangyang: "襄阳", ezhou: "鄂州", jingmen: "荆门", xiaogan: "孝感",
  jingzhou: "荆州", huanggang: "黄冈", xianning: "咸宁", suizhou: "随州",
  changsha: "长沙", zhuzhou: "株洲", xiangtan: "湘潭", hengyang: "衡阳",
  shaoyang: "邵阳", yueyang: "岳阳", changde: "常德", zhangjiajie: "张家界",
  yiyang: "益阳", chenzhou: "郴州", yongzhou: "永州", huaihua: "怀化",
  loudi: "娄底", zhengzhou: "郑州", kaifeng: "开封", luoyang: "洛阳",
  pingdingshan: "平顶山", anyang: "安阳", hebi: "鹤壁", xinxiang: "新乡",
  jiaozuo: "焦作", puyang: "濮阳", xuchang: "许昌", luohe: "漯河",
  sanmenxia: "三门峡", nanyang: "南阳", shangqiu: "商丘", xinyang: "信阳",
  zhoukou: "周口", zhumadian: "驻马店",
  // 华南
  shaoguan: "韶关", zhuhai: "珠海", shantou: "汕头", foshan: "佛山",
  jiangmen: "江门", zhanjiang: "湛江", maoming: "茂名", zhaoqing: "肇庆",
  huizhou: "惠州", meizhou: "梅州", shanwei: "汕尾", yangjiang: "阳江",
  qingyuan: "清远", dongguan: "东莞", zhongshan: "中山", chaozhou: "潮州",
  jieyang: "揭阳", yunfu: "云浮", nanning: "南宁", liuzhou: "柳州",
  guilin: "桂林", wuzhou: "梧州", beihai: "北海", fangchenggang: "防城港",
  qinzhou: "钦州", guigang: "贵港", yulin: "玉林", baise: "百色",
  hezhou: "贺州", hechi: "河池", laibin: "来宾", chongzuo: "崇左",
  haikou: "海口", sanya: "三亚", danzhou: "儋州",
  // 西南
  mianyang: "绵阳", zigong: "自贡", panzhihua: "攀枝花", luzhou: "泸州",
  deyang: "德阳", guangyuan: "广元", suining: "遂宁", neijiang: "内江",
  leshan: "乐山", nanchong: "南充", meishan: "眉山", yibin: "宜宾",
  guangan: "广安", dazhou: "达州", yaan: "雅安", bazhong: "巴中",
  ziyang: "资阳", guiyang: "贵阳", liupanshui: "六盘水", zunyi: "遵义",
  anshun: "安顺", bijie: "毕节", tongren: "铜仁", qujing: "曲靖",
  yuxi: "玉溪", baoshan_city: "保山", zhaotong: "昭通", lijiang: "丽江",
  lincang: "临沧", dali: "大理",
  // 西北
  xian: "西安", tongchuan: "铜川", baoji: "宝鸡", xianyang: "咸阳",
  weinan: "渭南", yanan: "延安", hanzhong: "汉中", ankang: "安康",
  shangluo: "商洛", lanzhou: "兰州", jinchang: "金昌", baiyin: "白银",
  tianshui: "天水", wuwei: "武威", zhangye: "张掖", pingliang: "平凉",
  jiuquan: "酒泉", qingyang: "庆阳", dingxi: "定西", longnan: "陇南",
  xining: "西宁", yinchuan: "银川", shizuishan: "石嘴山", wuzhong_nx: "吴忠",
  guyuan: "固原", zhongwei: "中卫", karamay: "克拉玛依", turpan: "吐鲁番",
  hami: "哈密", lhasa: "拉萨", urumqi: "乌鲁木齐",
};

/**
 * 剥离城市名尾部的行政后缀，便于字典查询
 * - 英文后缀：", City" / " City" / " City District" / " Municipality"
 * - 中文后缀：市 / 区 / 县 / 镇 / 村 / 特别行政区 / 自治区 / 自治州 / 盟
 *
 * 注意：仅在中文模式（locale === "zh"）下剥离英文 "City" 后缀；
 * 英文模式保留 "City" 后缀（如 "New York City" 是标准英文名）。
 */
function stripAdminSuffix(city: string, locale: Locale): string {
  if (!city) return "";
  let s = city.trim();
  if (locale === "zh") {
    // 中文模式：剥离中英文行政后缀，确保 "Jinjiang City" / "晋江市" 都能命中字典
    s = s
      .replace(/[,\s]+city\s*(district|municipality)?$/i, "")
      .replace(/[,\s]+municipality$/i, "")
      .replace(/(市|区|县|镇|村|特别行政区|自治区|自治州|盟)$/u, "")
      .trim();
  } else {
    // 英文模式：仅剥离中文后缀（避免英文 "City" 被错误剥离，如 "New York City"）
    s = s.replace(/(市|区|县|镇|村|特别行政区|自治区|自治州|盟)$/u, "").trim();
  }
  return s;
}

/**
 * 通用地点本地化函数
 *
 * 解析顺序：
 * 1) 剥离行政后缀（City / 市 / 区 等），避免 "Jinjiang City" 因后缀未命中字典
 * 2) 国家维度匹配（resolveCountryKey 兼容 key / en / zh 反查）
 * 3) 城市维度匹配（resolveCityKey 同上）
 * 4) 拼音扩展字典兜底（覆盖 GLOBAL_LOCATIONS 未收录的中国大陆城市/区县）
 * 5) 未命中：智能格式化返回（中文模式原样保留中文字符，英文模式标题格式）
 *
 * @param locationStr 标准 key、英文国名/城市名、中文名或偏门地名任意字符串
 * @param lang        当前语言（"zh" / "en" / "zh-CN" / "en-US" 等均支持）
 * @returns 对应语言的地名；未命中时降级返回原字符串
 */
export const getLocalizedLocationName = (
  locationStr: string,
  lang: string,
): string => {
  if (!locationStr) return "";

  // 数据清洗：部分逆地理编码结果会携带分号拼接的重复名（如 "洛杉矶;洛杉矶"），
  // 统一取第一段，避免脏字符串导致字典未命中而原样透出
  const cleaned = locationStr.split(/[;；]/)[0].trim();
  if (!cleaned) return "";
  // 转换语言代码（兼容 "zh-CN" / "en-US" 等 BCP-47 tag）
  const locale: Locale = lang && lang.startsWith("zh") ? "zh" : "en";

  // 标准化：trim + 内部空格转下划线 + 全小写，用于 key 比对
  const normalizedKey = cleaned
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");

  // 0) 权威地名词典（geo-i18n CITY_MAP）最高优先级：
  //    覆盖繁体中文（米蘭→米兰）、本地拼写（Milano→Milan/Roma→Rome）与
  //    小众城市别名，保证新旧数据（含历史繁体行）全站显示统一
  const geoHit = lookupCityEntry(cleaned);
  if (geoHit) {
    return locale === "zh" ? geoHit.zh : geoHit.en;
  }

  // 1) 先按"国家"维度尝试匹配
  //    - 若 locationStr 本身就是国家 key（如 "france"），resolveCountryKey 会返回它本身
  //    - 若是英文/中文名（如 "France" / "法国"），resolveCountryKey 也能反查到 key
  const countryKey = resolveCountryKey(cleaned) || resolveCountryKey(normalizedKey);
  if (countryKey) {
    return getLocalizedCountry(countryKey, locale);
  }

  // 2) 再按"城市"维度尝试匹配（先尝试原值，再尝试剥离后缀的值）
  const cityKey = resolveCityKey(cleaned) || resolveCityKey(normalizedKey);
  if (cityKey) {
    return getLocalizedCity(cityKey, locale);
  }

  // 2.1) 剥离行政后缀后重试城市字典（"Jinjiang City" → "Jinjiang" → "晋江"）
  const stripped = stripAdminSuffix(cleaned, locale);
  if (stripped && stripped !== cleaned) {
    const strippedKey = stripped.toLowerCase().trim().replace(/\s+/g, "_");
    const strippedCityKey = resolveCityKey(stripped) || resolveCityKey(strippedKey);
    if (strippedCityKey) {
      return getLocalizedCity(strippedCityKey, locale);
    }
  }

  // 3) 拼音扩展字典兜底（仅中文模式生效；英文模式跳过以保留原始拼音）
  if (locale === "zh") {
    const lookupKey = (stripped || cleaned).toLowerCase().trim().replace(/\s+/g, "_");
    const extHit = PINYIN_CN_EXT_MAP[lookupKey];
    if (extHit) return extHit;
    // 兜底再尝试未剥离的原始 key
    const rawHit = PINYIN_CN_EXT_MAP[normalizedKey];
    if (rawHit) return rawHit;
  }

  // 4) 未命中字典：智能格式化返回
  //    - 中文模式：含中文字符则原样返回；不含则按英文标题格式（保留可读性）
  //    - 英文模式：原样返回
  if (locale === "zh") {
    if (/[\u4e00-\u9fa5]/.test(cleaned)) return cleaned;
    // 中文模式下英文地名兜底：返回剥离后缀的标题格式（避免显示 "Jinjiang City"）
    return (stripped || cleaned).replace(/\b\w/g, (m) => m.toUpperCase());
  }
  return cleaned;
};

/**
 * 本地化城市+国家组合显示文本
 * ─────────────────────────────────────────────────────────────────────────
 * 全站位置显示（餐厅卡片/详情、博物馆卡片/详情、地图打卡详情弹窗、足迹卡片/弹窗、
 * 打卡成功弹窗、时间线等）统一调用此函数，确保中英文切换时实时联动、显示干净纯粹的对应语言地名。
 *
 * 行为（中英双向）：
 * - 中文模式（locale 以 "zh" 开头）：返回 "城市，国家"（中文逗号 "，"）
 *   - 输入为英文/拼音/key 时自动查字典转中文："Bergamo" → "贝加莫"，"Italy" → "意大利"
 *   - 自动剥离 "City" / "市" / "区" 等行政后缀后再查字典
 * - 英文模式（locale 以 "en" 开头）：返回 "City, Country"（英文逗号+空格 ", "）
 *   - 输入为中文时自动查字典转英文："贝加莫" → "Bergamo"，"梵蒂冈城国" → "Vatican City"
 *   - 输入为意大利语等本地语言名时同样命中别名："roma" → "Rome"
 *
 * @param city    城市名（可为中文 / 英文 / 拼音 / 标准 key / 本地语言别名）
 * @param country 国家名（可为中文 / 英文 / 标准 key / 缩写别名）
 * @param lang    当前语言（"zh" / "en" / "zh-CN" / "en-US" 等均支持）
 * @returns 组合后的本地化位置文本；任一缺失时仅返回另一项；均缺失时返回 "未知地点" / "Unknown Location"
 */
export const getLocalizedLocationText = (
  city: string,
  country: string,
  lang: string,
): string => {
  const locale: Locale = lang && lang.startsWith("zh") ? "zh" : "en";
  // 数据清洗与去重：兼容 API 返回 / 历史库中分号拼接的重复名
  // （如 "洛杉矶;洛杉矶" → "洛杉矶"、"美国;美国" → "美国"），
  // 确保显示为干净的单一名称（如 "洛杉矶, 美国" / "Los Angeles, United States"）
  const cleanCity = (city || "").split(/[;；]/)[0].trim();
  const cleanCountry = (country || "").split(/[;；]/)[0].trim();
  const localizedCity = cleanCity ? getLocalizedLocationName(cleanCity, lang) : "";
  const localizedCountry = cleanCountry ? getLocalizedLocationName(cleanCountry, lang) : "";
  const separator = locale === "zh" ? "，" : ", ";
  if (localizedCity && localizedCountry) {
    return `${localizedCity}${separator}${localizedCountry}`;
  }
  if (localizedCity) return localizedCity;
  if (localizedCountry) return localizedCountry;
  return locale === "zh" ? "未知地点" : "Unknown Location";
};

/**
 * 拼装 "城市 · 详细地址" 形式的本地化组合文案，专用于票据模块
 * - 中文模式：`米兰 · pizza`
 * - 英文模式：`Milan · pizza`
 *
 * @param cityKey      标准 city_key（如 "milan"）；若为空则只返回 detail
 * @param detailAddress 详细地址（如商店名、街道）；可为空
 * @param lang         当前语言
 */
export const formatLocalizedReceiptLocation = (
  cityKey: string,
  detailAddress: string,
  lang: string,
): string => {
  const city = cityKey ? getLocalizedLocationName(cityKey, lang) : "";
  const detail = (detailAddress || "").trim();
  if (city && detail) return `${city} · ${detail}`;
  return city || detail || "";
};
