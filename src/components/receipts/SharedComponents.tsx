import { useState, useRef, useEffect, useMemo } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  getAllCities,
  getLocalizedCity,
  type Locale,
} from "@/constants/locations";

// ---------------------------------------------------------------------------
// 1. 三级日历选择器（Year → Month → Day）
// ---------------------------------------------------------------------------
interface CalendarPickerProps {
  month: Date;
  onMonthChange: (d: Date) => void;
  selected?: Date;
  onSelect: (d: Date) => void;
  isEn: boolean;
}

export function CalendarPicker({
  month,
  onMonthChange,
  selected,
  onSelect,
  isEn,
}: CalendarPickerProps) {
  const [mode, setMode] = useState<"day" | "month" | "year">("day");

  const MONTHS = isEn
    ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    : ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const WEEKDAYS = isEn
    ? ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
    : ["日", "一", "二", "三", "四", "五", "六"];

  const year = month.getFullYear();
  const monthIdx = month.getMonth();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // ---- Decade (Year) View ----
  if (mode === "year") {
    const decadeStart = Math.floor(year / 10) * 10;
    const years = Array.from({ length: 12 }, (_, i) => decadeStart + i);
    return (
      <div className="w-64 select-none bg-input">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(decadeStart - 10, monthIdx, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-foreground">
            {decadeStart} - {decadeStart + 9}
          </span>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(decadeStart + 10, monthIdx, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                onMonthChange(new Date(y, monthIdx, 1));
                setMode("month");
              }}
              className={`h-9 rounded-lg text-xs transition-all ${
                y === year
                  ? "bg-brand text-brand-foreground font-bold shadow-[0_0_10px_rgba(0,242,254,0.4)]"
                  : "text-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Month View ----
  if (mode === "month") {
    return (
      <div className="w-64 select-none bg-input">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year - 1, monthIdx, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMode("year")}
            className="text-sm font-medium text-foreground hover:text-brand transition-colors"
          >
            {year}
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year + 1, monthIdx, 1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {MONTHS.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onMonthChange(new Date(year, i, 1));
                setMode("day");
              }}
              className={`h-9 rounded-lg text-xs transition-all ${
                i === monthIdx
                  ? "bg-brand text-brand-foreground font-bold shadow-[0_0_10px_rgba(0,242,254,0.4)]"
                  : "text-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Day View ----
  const firstDay = new Date(year, monthIdx, 1);
  const firstDayOfWeek = firstDay.getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIdx, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const goPrevMonth = () => onMonthChange(new Date(year, monthIdx - 1, 1));
  const goNextMonth = () => onMonthChange(new Date(year, monthIdx + 1, 1));

  return (
    <div className="w-64 select-none bg-input">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={goPrevMonth}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("month")}
            className="text-sm font-medium text-foreground hover:text-brand transition-colors"
          >
            {MONTHS[monthIdx]}
          </button>
          <button
            type="button"
            onClick={() => setMode("year")}
            className="text-sm font-medium text-foreground hover:text-brand transition-colors"
          >
            {year}
          </button>
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] text-muted-foreground py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const isSelected = selected && isSameDay(cell, selected);
          const isToday = isSameDay(cell, new Date());
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(cell)}
              className={`h-8 w-8 rounded-full text-xs transition-all flex items-center justify-center ${
                isSelected
                  ? "bg-brand text-brand-foreground font-bold shadow-[0_0_10px_rgba(0,242,254,0.5)]"
                  : isToday
                  ? "text-brand border border-brand/30 hover:bg-brand/10"
                  : "text-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. 自定义暗夜下拉菜单
// ---------------------------------------------------------------------------
interface DropdownOption {
  value: string;
  label: string;
}

interface CustomDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (val: string) => void;
  placeholder?: string;
  isEn: boolean;
}

export function CustomDropdown({ value, options, onChange, placeholder, isEn }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder || (isEn ? "Select" : "选择");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-all ${
          open
            ? "border-brand/60 bg-input text-foreground"
            : "border-border bg-input text-foreground"
        }`}
      >
        <span>{selectedLabel}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                opt.value === value
                  ? "bg-muted text-brand"
                  : "text-foreground hover:bg-muted hover:text-brand"
              }`}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check className="w-4 h-4 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. 地点输入：城市智能联想输入框 (Autocomplete Combobox) + 详细地点
// ---------------------------------------------------------------------------
// 用户在左侧城市输入框键入文字（如 "milan" / "米兰" / "巴"）时，实时匹配
// GLOBAL_LOCATIONS 词库并弹出推荐列表（如：`米兰 / Milan, 意大利`）。
// 用户点选后：
//   - onCityChange 回调返回当前语言下的城市展示名（用于即时回显）
//   - onCityKeyChange 回调返回标准 city_key（如 "milan"），用于数据库持久化
// 右侧详细地点保持普通 input，用于补充商店名/街道等自由文本。
// ---------------------------------------------------------------------------
interface LocationInputProps {
  /** 当前语言下的城市展示名（用于回显） */
  city: string;
  /** 标准 city_key（如 "milan"），用于持久化；空字符串表示未选城市 */
  cityKey?: string;
  detail: string;
  onCityChange: (val: string) => void;
  onCityKeyChange?: (key: string) => void;
  onDetailChange: (val: string) => void;
  isEn: boolean;
  /** 当前语言（"zh" / "en"），用于推荐列表与回显本地化 */
  locale?: Locale;
}

export function LocationInput({
  city,
  cityKey,
  detail,
  onCityChange,
  onCityKeyChange,
  onDetailChange,
  isEn,
  locale,
}: LocationInputProps) {
  const currentLocale: Locale = locale || (isEn ? "en" : "zh");
  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当 cityKey 已存在但 city 显示名为空时（如旧数据回填），自动补本地化名
  useEffect(() => {
    if (cityKey && !city) {
      const localized = getLocalizedCity(cityKey, currentLocale);
      if (localized) onCityChange(localized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKey, city, currentLocale]);

  // 推荐列表：基于输入实时过滤全球城市扁平列表
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // 无输入时：返回热门 Top 8（前几个国家的首都/热门城市）
      return getAllCities().slice(0, 8);
    }
    return getAllCities().filter(
      (c) =>
        c.key.includes(q) ||
        c.en.toLowerCase().includes(q) ||
        c.zh.includes(query.trim()) ||
        c.countryEn.toLowerCase().includes(q) ||
        c.countryZh.includes(query.trim()),
    ).slice(0, 20);
  }, [query]);

  // 点击外部关闭推荐列表
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (item: { key: string; zh: string; en: string; countryKey: string; countryZh: string; countryEn: string }) => {
    const displayName = currentLocale === "zh" ? item.zh : item.en;
    onCityChange(displayName);
    onCityKeyChange?.(item.key);
    setQuery("");
    setShowSuggest(false);
    setHighlightIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggest || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      setShowSuggest(false);
    }
  };

  return (
    <div ref={containerRef} className="flex items-center gap-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm relative">
      {/* 左侧：城市联想输入 */}
      <div className="relative shrink-0 w-28">
        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-brand/60 pointer-events-none" />
        <input
          type="text"
          value={showSuggest ? query : city}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggest(true);
            onCityChange(e.target.value);
            // 用户手动清空输入时同步清空 cityKey，避免脏数据
            if (!e.target.value && cityKey) onCityKeyChange?.("");
          }}
          onFocus={() => {
            setQuery(city || "");
            setShowSuggest(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={isEn ? "City" : "城市"}
          className="bg-brand/10 border border-brand/30 text-brand text-xs pl-5 pr-1 py-1 rounded-md font-semibold focus:outline-none focus:border-brand/60 w-full"
        />
        {/* 推荐列表浮层 — 左对齐 + min-w 防挤压，确保城市名与国家名完整展示 */}
        {showSuggest && suggestions.length > 0 && (
          <div className="absolute left-0 top-full mt-1.5 w-full min-w-[260px] max-h-60 overflow-y-auto bg-card border border-border rounded-2xl z-50 p-2 shadow-2xl">
            {suggestions.map((c, idx) => (
              <button
                key={`${c.countryKey}:${c.key}`}
                type="button"
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => handleSelect(c)}
                className={`flex items-center justify-between w-full px-3 py-2 rounded-xl transition-colors ${
                  idx === highlightIdx
                    ? "bg-muted/80 text-brand"
                    : "text-foreground hover:bg-muted/80"
                }`}
              >
                <span className="text-foreground text-sm font-medium truncate">
                  {currentLocale === "zh" ? c.zh : c.en}
                </span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {currentLocale === "zh" ? c.countryZh : c.countryEn}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="text-muted-foreground font-bold px-1 select-none">·</span>

      {/* 右侧：详细地点自由输入 */}
      <input
        type="text"
        value={detail}
        onChange={(e) => onDetailChange(e.target.value)}
        placeholder={isEn ? "Store / Address" : "商店 / 详细地点"}
        className="bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none flex-1 min-w-0"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
