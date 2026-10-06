import { ChevronLeft, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
export const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
export const WEEKDAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// 6x7 = 42-day calendar grid (with overflow days)
export function getDaysInMonthGrid(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = firstDay.getDay();
  const grid: Date[] = [];
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDayOfWeek);
  for (let i = 0; i < 42; i++) {
    grid.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 1);
  }
  return grid;
}

export function getDecadeStart(year: number): number {
  return Math.floor(year / 10) * 10;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type CalendarMode = "day" | "month" | "year";

interface UnifiedCalendarGridProps {
  mode: CalendarMode;
  viewDate: Date;
  selectedDateStr: string;
  setMode: (m: CalendarMode) => void;
  setViewDate: (d: Date) => void;
  onSelectDate: (dStr: string) => void;
  labelText: string;
  isEn: boolean;
  zIndexClass?: string; // e.g. "z-50" or "z-[70]"
  /** 移动端是否使用居中蒙层（fixed overlay）防止被 modal overflow-hidden 裁切 */
  mobileOverlay?: boolean;
  /** 蒙层背景点击时的回调（通常关闭日历） */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Component — 主题自适应风格（Light/Dark via .dark）
//   外层：bg-card border border-border rounded-2xl p-4 shadow-2xl opacity-100
//   选中：bg-brand text-brand-foreground font-bold shadow-[0_0_10px_rgba(0,242,254,0.4)] rounded-full
//   箭头：text-muted-foreground hover:text-brand hover:bg-muted rounded-lg transition-colors p-1
//   普通日：text-foreground hover:bg-muted hover:text-brand rounded-full transition-colors
//   非本月：text-muted-foreground
//   今日：border border-brand/50 text-brand
// ---------------------------------------------------------------------------
export function UnifiedCalendarGrid({
  mode,
  viewDate,
  selectedDateStr,
  setMode,
  setViewDate,
  onSelectDate,
  labelText,
  isEn,
  zIndexClass = "z-50",
  mobileOverlay = false,
  onClose,
}: UnifiedCalendarGridProps) {
  const handlePrev = () => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    if (mode === "day") setViewDate(new Date(y, m - 1, 1));
    else if (mode === "month") setViewDate(new Date(y - 1, m, 1));
    else setViewDate(new Date(y - 10, m, 1));
  };

  const handleNext = () => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    if (mode === "day") setViewDate(new Date(y, m + 1, 1));
    else if (mode === "month") setViewDate(new Date(y + 1, m, 1));
    else setViewDate(new Date(y + 10, m, 1));
  };

  const handleTitleClick = () => {
    if (mode === "day") setMode("month");
    else if (mode === "month") setMode("year");
  };

  // Safe date parse (avoid timezone drift)
  const parseDate = (s: string) => {
    if (!s) return null;
    return new Date(s + "T00:00:00");
  };

  // 移动端蒙层定位：fixed 居中浮层 + 半透明背景，彻底逃离 modal overflow-hidden 裁切；
  // 桌面端 sm: 降级为 absolute 定位，保持原有轻量 Popover 体验
  const overlayCls = mobileOverlay
    ? `fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs sm:absolute sm:inset-auto sm:left-0 sm:top-full sm:mt-2 sm:block sm:bg-transparent sm:p-0 sm:backdrop-blur-none ${zIndexClass}`
    : `absolute left-0 top-full mt-2 ${zIndexClass}`;

  const cardCls = mobileOverlay
    ? "w-[300px] sm:w-64"
    : "w-64";

  return (
    <div
      onClick={mobileOverlay ? onClose : undefined}
      className={overlayCls}
    >
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${cardCls} animate-[scaleUp_0.15s_ease-out_forwards] rounded-2xl border border-border bg-card p-4 shadow-2xl`}
      style={{ opacity: 1 }}
    >
      {/* Header — three-segment symmetric layout */}
      <div className="mb-3.5 flex items-center justify-between border-b border-border pb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {labelText}
        </span>
        <button
          type="button"
          onClick={handleTitleClick}
          className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-bold text-foreground transition-colors hover:text-brand"
        >
          <span>
            {mode === "day" &&
              (isEn
                ? `${MONTHS_EN[viewDate.getMonth()]} ${viewDate.getFullYear()}`
                : `${viewDate.getFullYear()}年 ${MONTHS_ZH[viewDate.getMonth()]}`)}
            {mode === "month" && `${viewDate.getFullYear()}${isEn ? "" : "年"}`}
            {mode === "year" &&
              `${getDecadeStart(viewDate.getFullYear())} - ${getDecadeStart(viewDate.getFullYear()) + 9}`}
          </span>
          <span className="text-[8px] opacity-70">▼</span>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handlePrev}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-brand"
          >
            <ChevronLeft className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-brand"
          >
            <ChevronRight className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* A. Day view (6x7 = 42 cells) */}
      {mode === "day" && (
        <>
          <div className="mb-2 grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground">
            {(isEn ? WEEKDAYS_EN : WEEKDAYS_ZH).map((day, idx) => (
              <div key={idx}>{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-xs">
            {getDaysInMonthGrid(viewDate).map((dayDate) => {
              const localStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;
              const isSelected = selectedDateStr === localStr;
              const isToday = new Date().toDateString() === dayDate.toDateString();
              const isOverflow = dayDate.getMonth() !== viewDate.getMonth();
              return (
                <button
                  key={localStr}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDate(localStr);
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    isSelected
                      ? "bg-brand font-bold text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.5)]"
                      : isToday
                        ? "border border-brand/50 text-brand hover:bg-muted"
                        : isOverflow
                          ? "text-muted-foreground"
                          : "text-foreground hover:bg-muted hover:text-brand"
                  }`}
                >
                  {dayDate.getDate()}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* B. Month view (4x4 = 16 cells) */}
      {mode === "month" && (
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 py-2 text-center text-xs">
          {Array.from({ length: 16 }).map((_, idx) => {
            const monthIndex = idx % 12;
            const isCurrentYear = idx < 12;
            const targetYear = isCurrentYear ? viewDate.getFullYear() : viewDate.getFullYear() + 1;
            const parsed = parseDate(selectedDateStr);
            const isSelected = parsed && parsed.getMonth() === monthIndex && parsed.getFullYear() === targetYear;
            return (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewDate(new Date(targetYear, monthIndex, 1));
                  setMode("day");
                }}
                className={`mx-auto flex h-10 w-12 items-center justify-center rounded-full transition-colors ${
                  isSelected
                    ? "bg-brand font-bold text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.5)]"
                    : !isCurrentYear
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-foreground hover:bg-muted hover:text-brand"
                }`}
              >
                {isEn ? MONTHS_EN[monthIndex] : MONTHS_ZH[monthIndex]}
              </button>
            );
          })}
        </div>
      )}

      {/* C. Year view (4x4 = 16 cells) */}
      {mode === "year" && (
        <div className="grid grid-cols-4 gap-x-1.5 gap-y-3 py-2 text-center text-[11px]">
          {Array.from({ length: 16 }).map((_, idx) => {
            const decadeStart = getDecadeStart(viewDate.getFullYear());
            const targetYear = decadeStart - 2 + idx;
            const isCurrentDecade = targetYear >= decadeStart && targetYear < decadeStart + 10;
            const parsed = parseDate(selectedDateStr);
            const isSelected = parsed && parsed.getFullYear() === targetYear;
            return (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewDate(new Date(targetYear, viewDate.getMonth(), 1));
                  setMode("month");
                }}
                className={`mx-auto flex h-10 w-12 items-center justify-center rounded-full transition-colors ${
                  isSelected
                    ? "bg-brand font-bold text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.5)]"
                    : !isCurrentDecade
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-foreground hover:bg-muted hover:text-brand"
                }`}
              >
                {targetYear}
              </button>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
