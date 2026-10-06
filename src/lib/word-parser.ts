import mammoth from "mammoth";

// ---------------------------------------------------------------------------
// Legacy flat-plan interface (kept for backward compatibility)
// ---------------------------------------------------------------------------
export type ParsedPlan = {
  time_label: string;
  location: string;
  activity: string;
};

// ---------------------------------------------------------------------------
// Structured itinerary types — 对齐用户的 ParsedItinerary 规范
// ---------------------------------------------------------------------------
export interface ParsedItem {
  time?: string | null;   // "06:30" 或 null
  title: string;          // "降落米兰"
  description: string;    // 紧随其后的非空段落文本，换行完整保留
  category?: string;      // "行程" / "策略" / "备注" / "提示"（或英文别名，无时间戳卡片才有）
}

export interface ParsedDay {
  dayNumber: number;      // 1, 2, 3...
  date: string;           // "2026年9月16日"
  title: string;          // "夜航启程"
  items: ParsedItem[];    // 属于该天的数据节点列表
}

export interface ParsedItinerary {
  tripTitle: string;      // 文档 `# 标题` 提取的行程大标题
  days: ParsedDay[];
}

// ---------------------------------------------------------------------------
// 1. .docx → plain text
// ---------------------------------------------------------------------------
export async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// ---------------------------------------------------------------------------
// 2. 核心结构化解析器 — 流式逐行/逐段
//    支持用户规范的目标格式：
//      # 行程大标题
//      Day 1: 2026年9月16日 / Day 1: 2026-09-16 / Day 1: Sep 16, 2026
//      ## 每日主题大标题
//      [06:30] 带时间戳节点卡片
//      紧随其后的非空文本为 description
//      [行程] 策略卡片 / [策略] / [备注] / [提示]（英文别名 [Itinerary] / [Strategy] / [Notes] / [Tips]）
//      --- 天数分隔符（可选）
//    兼容 Word 导出丢失 # 前缀的情况：若单行符合 Day X:，下一行非空文字视作 dayTitle
// ---------------------------------------------------------------------------
const RE_TRIP_TITLE = /^#\s+(.+)/;                       // # 2026 意大利"山海交响"终极路书
// Day 1: 2026年9月16日 | Day 1: 2026-09-16 | Day 1: Sep 16, 2026 | Day 1: September 16th, 2026
const RE_DAY_DATE =
  /^Day\s*(\d+)\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s+\d{4})/i;
const RE_DAY_TITLE = /^##\s+(.+)/;                       // ## 夜航启程
// 时间 + 后面整行的完整内容为节点标题（贪婪到行尾，支持含空格的英文长句）
const RE_TIME_CARD = /^\[(\d{1,2}:\d{2})\]\s*(.+)$/;     // [06:30] 降落米兰 / [9:30] Breakfast
// [行程] / [策略] / [备注] / [提示]，英文别名 [Itinerary] / [Strategy] / [Notes] / [Tips]
const RE_STRATEGY_CARD =
  /^\[(行程|策略|备注|提示|Itinerary|Strategy|Notes?|Tips?)\]\s*(.+)$/i;
const RE_SEPARATOR = /^---$/;                            // --- 天数分隔符

export function parseStructuredItinerary(text: string): ParsedItinerary {
  // 兼容 \r\n / \n 换行符，trim 去除首尾空白但保留卡片正文中段换行
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines.map((l) => l.trim());

  let tripTitle = "";
  const days: ParsedDay[] = [];

  // 当前 Day 累积器
  let curDay: ParsedDay | null = null;
  // 当前 Item 累积器（等待下一段非空文本作为 description）
  let curItem: ParsedItem | null = null;
  // Word 兼容：若识别到 Day X: 但当天未出现 ## 标题，则取下一行非空文字作为 dayTitle
  let pendingDayTitleFromNextLine = false;

  const flushCurrentItem = () => {
    if (curItem && curDay) {
      // 确保 description 至少为空字符串而非 undefined
      curItem.description = curItem.description ?? "";
      curDay.items.push(curItem);
    }
    curItem = null;
  };

  const flushCurrentDay = () => {
    flushCurrentItem();
    if (curDay) {
      // Word 兼容兜底：若该天没有任何 ## 标题且 items 为空，至少保留 day 元信息
      days.push(curDay);
    }
    curDay = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      // 空行：结束当前 item 的 description 累积（但不强制，允许段落间空行）
      // 这里采用「空行也作为 description 一部分保留」的策略，保留排版原貌
      if (curItem) {
        curItem.description += "\n";
      }
      continue;
    }

    // 1. 行程大标题
    const tripMatch = line.match(RE_TRIP_TITLE);
    if (tripMatch && !tripTitle) {
      tripTitle = tripMatch[1].trim();
      continue;
    }

    // 2. 天数分隔符 ---（可选，提前 flush 当天）
    if (RE_SEPARATOR.test(line)) {
      flushCurrentDay();
      continue;
    }

    // 3. Day X: 日期
    const dayMatch = line.match(RE_DAY_DATE);
    if (dayMatch) {
      flushCurrentDay();
      curDay = {
        dayNumber: parseInt(dayMatch[1], 10),
        date: dayMatch[2].trim(),
        title: "",
        items: [],
      };
      // Word 兼容：若当天没有 ## 标题，则取下一行非空文字作为 dayTitle
      pendingDayTitleFromNextLine = true;
      continue;
    }

    // 4. 每日主题 ## 标题
    const dayTitleMatch = line.match(RE_DAY_TITLE);
    if (dayTitleMatch && curDay) {
      curDay.title = dayTitleMatch[1].trim();
      pendingDayTitleFromNextLine = false;
      continue;
    }

    // 5. 带时间戳节点卡片 [HH:MM] title
    const timeCardMatch = line.match(RE_TIME_CARD);
    if (timeCardMatch && curDay) {
      flushCurrentItem();
      curItem = {
        time: timeCardMatch[1].trim(),
        title: timeCardMatch[2].trim(),
        description: "",
      };
      pendingDayTitleFromNextLine = false;
      continue;
    }

    // 6. 无时间戳策略/备注卡片 [行程|策略|备注|提示] title
    const strategyMatch = line.match(RE_STRATEGY_CARD);
    if (strategyMatch && curDay) {
      flushCurrentItem();
      curItem = {
        time: null,
        category: strategyMatch[1].trim(),
        title: strategyMatch[2].trim(),
        description: "",
      };
      pendingDayTitleFromNextLine = false;
      continue;
    }

    // 7. Word 兼容兜底：Day X: 后下一行非空文字作为 dayTitle
    if (pendingDayTitleFromNextLine && curDay && !curDay.title) {
      curDay.title = line;
      pendingDayTitleFromNextLine = false;
      continue;
    }

    // 8. 普通文本行：累积为当前 item 的 description，或作为无标题节点
    if (curItem) {
      // 追加到当前 item 的 description（保留换行）
      curItem.description = curItem.description
        ? curItem.description + "\n" + line
        : line;
    } else if (curDay) {
      // 没有 [时间] / [策略] 卡片引导的裸文本：作为无时间戳节点
      curItem = {
        time: null,
        title: line,
        description: "",
      };
    }
    // 若尚未进入任何 Day，忽略孤立文本（通常是文档前言）
  }

  flushCurrentDay();

  return { tripTitle, days };
}

// ---------------------------------------------------------------------------
// 3. 扁平化适配器 — 将 ParsedItinerary 转换为 trip_plans 表结构
//    供 trip-info-module handleImportWord 直接调用，无需重复实现解析逻辑
// ---------------------------------------------------------------------------
export function flattenToTripPlans(
  parsed: ParsedItinerary,
  opts: {
    tripId: string;
    planName: string;
    startSequence?: number;
  },
): Array<{
  trip_id: string;
  plan_name: string;
  plan_date: string | null;
  plan_time: string | null;
  day_title: string | null;
  location: string;
  activity: string;
  sequence: number;
}> {
  const { tripId, planName, startSequence = 0 } = opts;
  const out: Array<{
    trip_id: string;
    plan_name: string;
    plan_date: string | null;
    plan_time: string | null;
    day_title: string | null;
    location: string;
    activity: string;
    sequence: number;
  }> = [];

  let seq = startSequence;

  for (const day of parsed.days) {
    // 将 "2026年9月16日" 转为 "2026-09-16"（若格式不符则原样保留）
    const dateNormalized = normalizeChineseDate(day.date);

    if (day.items.length === 0) {
      // 空白 Day 至少保留一行占位
      out.push({
        trip_id: tripId,
        plan_name: planName,
        plan_date: dateNormalized,
        plan_time: null,
        day_title: day.title || null,
        location: "Itinerary",
        activity: "",
        sequence: seq++,
      });
      continue;
    }

    for (const item of day.items) {
      out.push({
        trip_id: tripId,
        plan_name: planName,
        plan_date: dateNormalized,
        plan_time: item.time ?? null,
        day_title: day.title || null,
        // location 即 DayCard 的标题（h4）：必须承载 [HH:MM] / [标签] 之后的整行完整标题，
        // 严禁按空格截断取首词 —— 英文长标题（如 "The Last Supper at ..."）会因此只剩 "The"
        location: item.title || item.category || "Itinerary",
        // activity 仅承载紧随标题行之后的正文描述；无描述时留空，标题已由 location 完整展示
        activity: item.description,
        sequence: seq++,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 辅助：将 "2026年9月16日" / "Sep 16, 2026" / "September 16th, 2026" → "2026-09-16"
// ---------------------------------------------------------------------------
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeChineseDate(dateStr: string): string {
  const m = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const e = dateStr.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})$/i);
  if (e) {
    const mo = EN_MONTHS[e[1].slice(0, 3).toLowerCase()];
    if (mo) return `${e[3]}-${String(mo).padStart(2, "0")}-${String(e[2]).padStart(2, "0")}`;
  }
  return dateStr; // 格式不符，原样返回
}

// ---------------------------------------------------------------------------
// Legacy flat parser — 保留向后兼容（旧调用方仍可使用）
// ---------------------------------------------------------------------------
export function parseItineraryText(text: string): ParsedPlan[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const plans: ParsedPlan[] = [];
  let currentDay = "";

  const dayPattern = /^(?:Day\s*(\d+)|第\s*(\d+)\s*天|D\s*(\d+))\s*[:：]?\s*(.*)$/i;
  const timePattern = /(\d{1,2}[:：]\d{2}(?:\s*[APap][Mm])?|[上下午早晚]上?\d{1,2}(?:[:：]\d{2})?|[上下午早晚])/;
  const locationPattern = /(?:地点|Location|Loc|地址|Address)\s*[:：]\s*(.+)/i;

  for (const line of lines) {
    const dayMatch = line.match(dayPattern);
    if (dayMatch) {
      const dayNum = dayMatch[1] || dayMatch[2] || dayMatch[3];
      currentDay = `Day ${dayNum}`;
      const remaining = (dayMatch[4] || "").trim();
      if (remaining) {
        const parsed = parseLine(remaining, timePattern, locationPattern);
        if (parsed) {
          plans.push({
            ...parsed,
            time_label: parsed.time_label
              ? `${currentDay} ${parsed.time_label}`
              : currentDay,
          });
        }
      }
      continue;
    }

    const dayOnlyMatch = line.match(/^(?:Day\s*\d+|第\s*\d+\s*天|D\s*\d+)$/i);
    if (dayOnlyMatch) {
      currentDay = line;
      continue;
    }

    const parsed = parseLine(line, timePattern, locationPattern);
    if (parsed) {
      plans.push({
        ...parsed,
        time_label: currentDay
          ? `${currentDay} ${parsed.time_label}`.trim()
          : parsed.time_label,
      });
    }
  }

  if (plans.length === 0 && text.trim()) {
    plans.push({
      time_label: "",
      location: "",
      activity: text.trim().slice(0, 2000),
    });
  }

  return plans;
}

function parseLine(
  line: string,
  timePattern: RegExp,
  locationPattern: RegExp,
): ParsedPlan | null {
  if (!line) return null;

  let timeLabel = "";
  let location = "";
  let activity = line;

  const locMatch = line.match(locationPattern);
  if (locMatch) {
    location = locMatch[1].trim();
    activity = line.replace(locMatch[0], "").trim();
  }

  const timeMatch = activity.match(timePattern);
  if (timeMatch) {
    timeLabel = timeMatch[1].trim();
    activity = activity.replace(timeMatch[0], "").trim();
  } else {
    const fullTimeMatch = line.match(timePattern);
    if (fullTimeMatch) {
      timeLabel = fullTimeMatch[1].trim();
    }
  }

  activity = activity.replace(/^[\s:：\-—–|]+/, "").trim();

  if (!activity && location) {
    activity = location;
    location = "";
  }

  if (!activity && !timeLabel && !location) return null;
  if (activity.length < 1 && !timeLabel) return null;

  return {
    time_label: timeLabel,
    location,
    activity: activity || location || timeLabel || "(未命名)",
  };
}
