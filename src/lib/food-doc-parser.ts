import mammoth from "mammoth";
import { decodeTextFile } from "./museum-doc-parser";

// ---------------------------------------------------------------------------
// 美食模块「导入文档自动填充」双板块解析器
//
// 支持 .docx（mammoth extractRawText）/ .md / .txt（智能编码解码）。
// 同一文档可同时包含【特色菜规划】与【精选餐厅】两个板块，缺少任一板块时
// 自动平滑忽略，互不影响；两者都有时同时批量产出各自的数据行。
//
// 【推荐文档格式】
//
//   # 意大利美食攻略                     <- 文档标题（忽略）
//
//   ## 特色菜规划                        <- 板块 1 开始（关键词：特色菜/美食规划/
//                                             菜品规划/特色美食/Dishes/Specialties）
//   Day 1: 9月17日：米兰                  <- 天数 + 日期 + 城市主题
//   （英文模板等价写法：Day 1: Sep 17: Milan / Day 1: Sep 17, 2026: Milan，
//     年份缺省按 2026 年入库，与中文裸日期一致）
//   [前菜] 烩饭 Risotto allo Zafferano    <- 菜品分类卡片（前菜/主食/主菜/零食/
//                                             小吃/甜点），紧随下一行为简介
//   经典米兰烩饭，藏红花香气浓郁……
//   [甜点] 提拉米苏 Tiramisù
//   经典威尼托甜点……
//
//   ## 精选餐厅                          <- 板块 2 开始（关键词：精选餐厅/餐厅推荐/
//                                             餐厅清单/必吃餐厅/Restaurants 等）
//   ### Trattoria ZaZa（佛罗伦萨）        <- 餐厅条目（### 标题 / [餐厅] 前缀 /
//                                             餐厅：标签 / N. 编号行 / **加粗** 行）
//   餐段：晚餐                            <- 标签行（早餐/午餐/晚餐/下午茶）
//   城市：佛罗伦萨                        <- 城市标签（亦可从名称尾部括号提取）
//   国家：意大利
//   地址：Piazza del Mercato Centrale 26
//   【坐标】：43.7766, 11.2533            <- 高精坐标（选填）：【坐标】/【经纬度】/ GPS 均可，
//                                             值为「纬度, 经度」—— 命中直接写入 latitude/
//                                             longitude 并跳过网络地理编码，未填写按地址反算
//   营业时间：12:00 - 23:00
//   备注：排队名店，建议提前订位
//   必点菜品：                            <- 菜品列表开始（必点/推荐菜品/招牌菜）
//   - 佛罗伦萨牛排（€45/kg）招牌必点      <- 菜品行：名称 + 价格（€/$/¥）+ 备注
//   - 提拉米苏（€8）
//
// 板块顺序任意（可先餐厅后特色菜）；docx 无 # 前缀时靠关键词裸行或
// 【】/[] 包裹行识别板块标题。
// ---------------------------------------------------------------------------

/** 板块 1：特色菜 → trip_food_plans 行 */
export interface ParsedFoodPlanRow {
  trip_id: string;
  plan_name: string;
  plan_date: string | null;
  day_title: string | null;
  course_type: string;
  dish_name: string;
  description: string | null;
  sequence: number;
}

/** 板块 2：餐厅必点菜品（对齐 restaurants/types.ts Dish 结构） */
export interface ParsedRestaurantDish {
  id: string;
  name: string;
  price: string;
  note: string;
}

/** 板块 2：餐厅 → trip_restaurants 行 */
export interface ParsedRestaurantRow {
  trip_id: string;
  name: string;
  city: string | null;
  country: string | null;
  meal_type: string;
  address: string | null;
  hours: string | null;
  notes: string | null;
  dishes: ParsedRestaurantDish[];
  /** 高精坐标：文档【坐标】/【经纬度】行预埋则直接采用（跳过地理编码）；
   *  未预埋时导入链路按 地址+城市+国家 自动正向地理编码反算（未命中为 null） */
  latitude?: number | null;
  longitude?: number | null;
}

export interface ParsedDiningDoc {
  /** 特色菜规划板块（文档无该板块时为空数组） */
  foodPlans: ParsedFoodPlanRow[];
  /** 精选餐厅板块（文档无该板块时为空数组） */
  restaurants: ParsedRestaurantRow[];
}

// ---------------------------------------------------------------------------
// 文件 → 纯文本
// ---------------------------------------------------------------------------

export async function extractDiningText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  return decodeTextFile(file);
}

// ---------------------------------------------------------------------------
// 板块标题识别
// ---------------------------------------------------------------------------

// 带 # / 【】 / [] / ** 前缀时允许单词「餐厅 / Restaurant」
const RE_RESTAURANT_SECTION_MARKED =
  /^(?:#{1,6}\s*|【|\[|\*\*)\s*(精选餐厅|餐厅推荐|推荐餐厅|餐厅清单|餐厅列表|餐厅指南|餐厅攻略|必吃餐厅|美食餐厅|餐厅|Restaurants?|Restaurant\s+(?:Guide|List|Recommendations?))\s*(?:】|\]|\*\*)?\s*[:：]?\s*$/i;
// 裸行仅允许复合关键词，避免正文误判
const RE_RESTAURANT_SECTION_BARE =
  /^(精选餐厅|餐厅推荐|推荐餐厅|餐厅清单|餐厅列表|餐厅指南|餐厅攻略|必吃餐厅|美食餐厅|Restaurants?)\s*[:：]?\s*$/i;

const RE_DISH_SECTION_MARKED =
  /^(?:#{1,6}\s*|【|\[|\*\*)\s*(特色菜|特色美食|特色菜品|美食规划|美食计划|菜品规划|每日美食|美食攻略|Dishes|Food\s*Plans?|Specialties)\s*(?:】|\]|\*\*)?\s*[:：]?\s*$/i;
const RE_DISH_SECTION_BARE =
  /^(特色菜|特色美食|特色菜品|美食规划|美食计划|菜品规划|每日美食|Dishes|Specialties)\s*[:：]?\s*$/i;

// ---------------------------------------------------------------------------
// 特色菜板块解析常量
// ---------------------------------------------------------------------------

// [前菜|主食|主菜|零食|小吃|甜点] 菜品名（用户规范；兼容英文类别词）
const RE_COURSE_CARD = /^\[(前菜|主食|主菜|零食|小吃|甜点|Starter|Main|Snack|Dessert)\]\s*(.+)/i;
const COURSE_KEY_MAP: Record<string, string> = {
  前菜: "Starter",
  主食: "Main",
  主菜: "Main",
  零食: "Snack",
  小吃: "Snack",
  甜点: "Dessert",
  starter: "Starter",
  main: "Main",
  snack: "Snack",
  dessert: "Dessert",
};

// 简介标签行：简介：xxx / [简介] xxx / 说明：xxx / 描述：xxx / Introduction: xxx
// —— 内容必须归入上一道菜品的 description，严禁创建新菜品
const RE_INTRO_TAGGED =
  /^(?:【|\[)\s*(简介|说明|描述|介绍|Introduction|Description|Intro)\s*(?:】|\])\s*(.*)$/i;
const RE_INTRO_LABELED =
  /^(?:简介|说明|描述|介绍|Introduction|Description|Intro)\s*[:：]\s*(.*)$/i;

// 英文日期行：Day 1: Sep 17: Milan / Day 1: Sep 17, 2026: Milan（年/月/日 + 城市主题）
// 年份缺省按 2026 年入库，与中文裸日期「9月17日」保持一致；月份词必须命中英文月份表
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const RE_EN_DAY_LINE =
  /^Day\s*\d+\s*[:：]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\s*[:：]\s*(.*)$/i;

/** 剥离行首的简介标签前缀（菜品卡片前瞻收集简介时使用） */
function stripIntroPrefix(s: string): string {
  return s
    .replace(/^(?:【|\[)\s*(?:简介|说明|描述|介绍|Introduction|Description|Intro)\s*(?:】|\])\s*/i, "")
    .replace(/^(?:简介|说明|描述|介绍|Introduction|Description|Intro)\s*[:：]\s*/i, "")
    .trim();
}

/** 将简介内容追加到上一道菜品（无历史菜品时静默忽略，绝不新建） */
function appendIntroToLastDish(foodPlans: ParsedFoodPlanRow[], content: string): void {
  const text = content.trim();
  if (!text || foodPlans.length === 0) return;
  const last = foodPlans[foodPlans.length - 1];
  last.description = last.description ? `${last.description}\n${text}` : text;
}

// ---------------------------------------------------------------------------
// 餐厅板块解析常量
// ---------------------------------------------------------------------------

// 餐厅条目标记：### 标题 / [餐厅] 前缀 / 餐厅：标签 / **加粗** 行
const RE_REST_ENTRY_HEADING = /^#{1,6}\s+(.+)$/;
const RE_REST_ENTRY_TAGGED = /^(?:【|\[)\s*餐厅\s*(?:】|\])\s*(.+)/;
const RE_REST_ENTRY_LABEL = /^餐厅\s*[:：]\s*(.+)/;
const RE_REST_ENTRY_BOLD = /^\*\*(.+?)\*\*\s*[:：]?\s*$/;
const RE_NUMBERED = /^(\d+)\s*[.、)）]\s*(.+)/;
const RE_BULLET = /^[-•○●*·]\s*(.+)/;

// 标签行 → 餐厅字段
const REST_FIELD_PATTERNS: { re: RegExp; field: "meal_type" | "city" | "country" | "address" | "hours" | "notes" }[] = [
  { re: /^(?:餐段|用餐|餐别|类型|Meal(?:\s*Type)?)\s*[:：]\s*(.+)/i, field: "meal_type" },
  { re: /^(?:城市|City)\s*[:：]\s*(.+)/i, field: "city" },
  { re: /^(?:国家|Country)\s*[:：]\s*(.+)/i, field: "country" },
  { re: /^(?:详细地址|地址|位置|Address|Location)\s*[:：]\s*(.+)/i, field: "address" },
  { re: /^(?:营业时间|开放时间|营业|时间|Hours?|Opening\s*Hours?)\s*[:：]\s*(.+)/i, field: "hours" },
  { re: /^(?:备注|小贴士|贴士|提示|Tips?|Notes?)\s*[:：]\s*(.+)/i, field: "notes" },
];

// 隐形高精坐标标签行：【坐标】/【经纬度】/ 坐标 / 经纬度 / GPS（值形如 43.7766, 11.2533）。
// 命中后直接写入餐厅 latitude/longitude，导入链路跳过网络地理编码；标签行本身绝不落入备注。
const RE_REST_COORDS_LABEL =
  /^(?:【\s*(?:坐标|经纬度|GPS)\s*】|\[\s*(?:坐标|经纬度|GPS)\s*\]|坐标|经纬度|GPS)\s*[:：]/i;
// 坐标值：纬度, 经度（兼容中文逗号与空格分隔）
const RE_COORDS_VALUE = /^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/;

/** 将坐标标签行的值解析为合法经纬度（纬度 [-90,90] / 经度 [-180,180]），非法返回 null */
function parseCoordsValue(raw: string): { lat: number; lng: number } | null {
  const m = raw.trim().match(RE_COORDS_VALUE);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// 必点菜品列表开关
const RE_DISH_LIST_HEADER =
  /^(?:必点菜品|必点菜|必点|推荐菜品|推荐菜|推荐菜单|招牌菜|招牌|必吃|Must[ -]?Orders?|Recommended\s*Dishes?|Signature\s*Dishes?)\s*[:：]?\s*$/i;

// 价格模式：€45 / €45/kg / ¥50 / $12 / 45€ / （€8）等
const RE_PRICE = /[€$¥￥]\s*\d[\d,.]*(?:\s*\/\s*[a-zA-Z\u4e00-\u9fa5]+)?|\d[\d,.]*\s*[€$¥￥]/;

/** 餐段文本 → MealType（对齐 restaurants/types.ts） */
function mapMealType(v: string): string {
  const s = v.trim().toLowerCase();
  if (/(早餐|早点|breakfast|brunch|早午餐)/.test(s)) return "breakfast";
  if (/(午餐|午饭|lunch)/.test(s)) return "lunch";
  if (/(下午茶|咖啡|茶歇|甜品|cafe|café|coffee|tea|snack|小吃)/.test(s)) return "snack";
  if (/(晚餐|晚饭|宵夜|夜宵|dinner|supper)/.test(s)) return "dinner";
  return "dinner";
}

/** 必点菜品行：名称 + 价格 + 备注 三段式提取 */
function parseRestaurantDish(raw: string, restIdx: number, dishIdx: number): ParsedRestaurantDish {
  const text = raw.trim();
  let name = text;
  let price = "";
  let note = "";

  const pm = text.match(RE_PRICE);
  if (pm && pm.index !== undefined) {
    price = pm[0].trim();
    name = text.slice(0, pm.index);
    note = text.slice(pm.index + pm[0].length);
  } else {
    const colonIdx = text.search(/[：:]/);
    if (colonIdx >= 0) {
      name = text.slice(0, colonIdx);
      note = text.slice(colonIdx + 1);
    }
  }

  name = name
    .replace(/[（(【\s：:，,。；;·—\-–]+$/, "")
    .replace(/^[【】\s]+/, "")
    .trim();
  note = note
    .replace(/^[\s）)】：:，,。；;·—\-–]+/, "")
    .trim();

  return { id: `r${restIdx}-d${dishIdx}`, name, price, note };
}

// ---------------------------------------------------------------------------
// 核心解析器 — 单文档双板块状态机
// ---------------------------------------------------------------------------

export function parseDiningDocument(
  text: string,
  opts: { tripId: string; planName: string },
): ParsedDiningDoc {
  const { tripId, planName } = opts;
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());

  const foodPlans: ParsedFoodPlanRow[] = [];
  const restaurants: ParsedRestaurantRow[] = [];

  // ---- 板块状态：默认特色菜（向后兼容旧版纯特色菜文档） ----
  let section: "dishes" | "restaurants" = "dishes";

  // ---- 特色菜状态 ----
  let currentPlanDate = "";
  let currentDayTitle = "";
  // 默认值降级：未声明分类时归类为主食（Main）
  let currentCourseType = "Main";

  // ---- 餐厅状态 ----
  let curRestaurant: ParsedRestaurantRow | null = null;
  // 「必点菜品：」之后的列表模式（编号行解析为菜品而非新餐厅）
  let inDishList = false;

  const flushRestaurant = () => {
    if (curRestaurant && curRestaurant.name.trim()) {
      restaurants.push(curRestaurant);
    }
    curRestaurant = null;
    inDishList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // ================= 0. 板块切换 =================
    if (RE_RESTAURANT_SECTION_MARKED.test(line) || RE_RESTAURANT_SECTION_BARE.test(line)) {
      if (section !== "restaurants") flushRestaurant();
      section = "restaurants";
      continue;
    }
    if (RE_DISH_SECTION_MARKED.test(line) || RE_DISH_SECTION_BARE.test(line)) {
      if (section !== "dishes") flushRestaurant();
      section = "dishes";
      continue;
    }

    // ================= 餐厅板块 =================
    if (section === "restaurants") {
      // 1. 餐厅条目：### 标题
      const headingMatch = line.match(RE_REST_ENTRY_HEADING);
      if (headingMatch && headingMatch[1].trim()) {
        flushRestaurant();
        curRestaurant = newRestaurant(tripId, headingMatch[1].trim());
        continue;
      }

      // 2. 餐厅条目：[餐厅] 名称 / 【餐厅】名称
      const taggedMatch = line.match(RE_REST_ENTRY_TAGGED);
      if (taggedMatch && taggedMatch[1].trim()) {
        flushRestaurant();
        curRestaurant = newRestaurant(tripId, taggedMatch[1].trim());
        continue;
      }

      // 3. 餐厅条目：餐厅：名称
      const labelMatch = line.match(RE_REST_ENTRY_LABEL);
      if (labelMatch && labelMatch[1].trim()) {
        flushRestaurant();
        curRestaurant = newRestaurant(tripId, labelMatch[1].trim());
        continue;
      }

      // 4. 餐厅条目：**加粗** 行
      const boldMatch = line.match(RE_REST_ENTRY_BOLD);
      if (boldMatch && boldMatch[1].trim()) {
        flushRestaurant();
        curRestaurant = newRestaurant(tripId, boldMatch[1].trim());
        continue;
      }

      // 5. 标签行（餐段/城市/国家/地址/营业时间/备注）
      let fieldMatched = false;
      for (const { re, field } of REST_FIELD_PATTERNS) {
        const m = line.match(re);
        if (m && m[1] && m[1].trim()) {
          fieldMatched = true;
          const value = m[1].trim();
          if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
          if (field === "meal_type") {
            curRestaurant.meal_type = mapMealType(value);
          } else if (field === "notes") {
            curRestaurant.notes = curRestaurant.notes ? `${curRestaurant.notes}\n${value}` : value;
          } else {
            (curRestaurant as any)[field] = value;
          }
          break;
        }
      }
      if (fieldMatched) continue;

      // 5.5 隐形高精坐标行：【坐标】：43.7766, 11.2533 —— 直接写入 latitude/longitude，
      //     导入链路据此跳过网络地理编码；无论值是否合法，坐标标签行绝不落入备注
      if (RE_REST_COORDS_LABEL.test(line)) {
        const coords = parseCoordsValue(line.replace(RE_REST_COORDS_LABEL, ""));
        if (coords) {
          if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
          curRestaurant.latitude = coords.lat;
          curRestaurant.longitude = coords.lng;
        }
        continue;
      }

      // 6. 必点菜品列表开关
      if (RE_DISH_LIST_HEADER.test(line)) {
        inDishList = true;
        if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
        continue;
      }

      // 7. 编号行：列表模式 → 菜品；否则 → 新餐厅条目（编号是 docx 餐厅列表常见形态）
      const numberedMatch = line.match(RE_NUMBERED);
      if (numberedMatch && numberedMatch[2].trim()) {
        if (inDishList) {
          if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
          curRestaurant.dishes.push(
            parseRestaurantDish(numberedMatch[2], restaurants.length, curRestaurant.dishes.length),
          );
        } else {
          flushRestaurant();
          curRestaurant = newRestaurant(tripId, numberedMatch[2].trim());
        }
        continue;
      }

      // 8. 圆点行 → 当前餐厅的菜品
      const bulletMatch = line.match(RE_BULLET);
      if (bulletMatch && bulletMatch[1].trim()) {
        if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
        curRestaurant.dishes.push(
          parseRestaurantDish(bulletMatch[1], restaurants.length, curRestaurant.dishes.length),
        );
        continue;
      }

      // 9. 裸文本 → 归入当前餐厅备注（首个字段未命名时兜底为名称）
      if (!curRestaurant) curRestaurant = newRestaurant(tripId, "");
      if (!curRestaurant.name) {
        curRestaurant.name = line;
      } else {
        curRestaurant.notes = curRestaurant.notes ? `${curRestaurant.notes}\n${line}` : line;
      }
      continue;
    }

    // ================= 特色菜板块 =================
    // 1. 日期行（9月17日 或 Day X: 2026年9月17日）
    const dateMatch =
      line.match(/(\d{1,2})月(\d{1,2})日/) ||
      line.match(/^Day\s*\d+\s*[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/i);
    if (dateMatch) {
      if (dateMatch.length === 4 && dateMatch[1] && dateMatch[2] && dateMatch[3]) {
        currentPlanDate = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, "0")}-${String(dateMatch[3]).padStart(2, "0")}`;
      } else {
        const month = String(dateMatch[1]).padStart(2, "0");
        const day = String(dateMatch[2]).padStart(2, "0");
        currentPlanDate = `2026-${month}-${day}`;
      }
      // 日期之后的剩余文本 → 当日城市/主题（如 "Day 1: 9月17日：米兰" → "米兰"）
      const afterDate = line.slice(line.indexOf(dateMatch[0]) + dateMatch[0].length);
      currentDayTitle = afterDate.replace(/^[\s:：,，\-—]+/, "").trim();
      continue;
    }

    // 1.5 英文日期行（Day 1: Sep 17: Milan / Day 1: Sep 17, 2026: Milan）
    const enDayMatch = line.match(RE_EN_DAY_LINE);
    if (enDayMatch) {
      const mo = EN_MONTHS[enDayMatch[1].slice(0, 3).toLowerCase()];
      if (mo) {
        const year = enDayMatch[3] ? parseInt(enDayMatch[3], 10) : 2026;
        currentPlanDate = `${year}-${String(mo).padStart(2, "0")}-${String(parseInt(enDayMatch[2], 10)).padStart(2, "0")}`;
        currentDayTitle = enDayMatch[4].trim();
        continue;
      }
      // 月份词无效（如城市名 Milan 恰非月份）→ 不视为日期行，落入后续规则
    }

    // 2. 简介标签行（未被菜品卡片前瞻消费的孤立简介）→ 归入上一道菜品的
    //    description，严禁作为独立菜品创建新卡片
    const introTagged = line.match(RE_INTRO_TAGGED);
    if (introTagged) {
      appendIntroToLastDish(foodPlans, introTagged[2] ?? "");
      continue;
    }
    const introLabeled = line.match(RE_INTRO_LABELED);
    if (introLabeled) {
      appendIntroToLastDish(foodPlans, introLabeled[1] ?? "");
      continue;
    }

    // 3. [前菜|主食|主菜|零食|小吃|甜点] 菜品名 分类卡片 + 下文简介
    //    —— 唯一合法的新菜品入口：只有带方括号分类标签的行才会创建菜品
    const courseCardMatch = line.match(RE_COURSE_CARD);
    if (courseCardMatch) {
      const categoryKey = courseCardMatch[1];
      currentCourseType = COURSE_KEY_MAP[categoryKey.toLowerCase()] || COURSE_KEY_MAP[categoryKey] || "Main";
      const dishName = courseCardMatch[2].trim();

      // 提取紧随其后的连续非空描述行（「简介：」等标签前缀自动剥离后并入）
      let desc = "";
      let lastConsumed = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        // 遇到分类卡片/日期/分隔符/板块标题即停止
        if (
          RE_COURSE_CARD.test(nextLine) ||
          /(\d{1,2})月(\d{1,2})日/.test(nextLine) ||
          /^---$/.test(nextLine) ||
          nextLine.startsWith("Day ") ||
          RE_RESTAURANT_SECTION_MARKED.test(nextLine) ||
          RE_RESTAURANT_SECTION_BARE.test(nextLine) ||
          RE_DISH_SECTION_MARKED.test(nextLine) ||
          RE_DISH_SECTION_BARE.test(nextLine)
        ) {
          break;
        }
        if (nextLine) {
          const piece = stripIntroPrefix(nextLine);
          desc = desc ? desc + "\n" + piece : piece;
          lastConsumed = j;
        }
      }

      foodPlans.push({
        trip_id: tripId,
        plan_name: planName,
        plan_date: currentPlanDate || null,
        day_title: currentDayTitle || null,
        course_type: currentCourseType,
        dish_name: dishName,
        description: desc || null,
        sequence: foodPlans.length,
      });
      // 主循环跳过已并入简介的行 —— 修复「简介：xxx」被二次消费成幽灵菜品的关键
      i = lastConsumed;
      continue;
    }

    // 4. 其余裸文本行一律忽略：简介类标签已在上方归入上一道菜，
    //    未带 [分类] 标签的行不构成新菜品（收紧识别，杜绝幽灵卡片）
  }

  flushRestaurant();

  return { foodPlans, restaurants };
}

/** 新建餐厅累积器：名称尾部括号短文本自动提取为城市（无数字/货币符号时） */
function newRestaurant(tripId: string, rawName: string): ParsedRestaurantRow {
  let name = rawName.trim();
  let city: string | null = null;

  const cityMatch = name.match(/[（(]([^（）()]{1,12})[）)]\s*$/);
  if (cityMatch && !/[\d€$¥￥]/.test(cityMatch[1])) {
    city = cityMatch[1].trim();
    name = name.replace(/[（(][^（）()]{1,12}[）)]\s*$/, "").trim();
  }

  return {
    trip_id: tripId,
    name,
    city,
    country: null,
    meal_type: "dinner",
    address: null,
    hours: null,
    notes: null,
    dishes: [],
  };
}
