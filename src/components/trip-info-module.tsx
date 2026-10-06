import { useCallback, useEffect, useRef, useState } from "react";
import {
  Megaphone,
  ListChecks,
  Plus,
  Trash2,
  Loader2,
  Check,
  CalendarDays,
  Clock,
  MapPin,
  Upload,
  FileText,
  X,
  Compass,
  Pencil,
  UtensilsCrossed,
  Save,
  Copy,
  Eraser,
  ChevronDown,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useT, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { extractTextFromDocx, parseStructuredItinerary, flattenToTripPlans, type ParsedPlan } from "@/lib/word-parser";
import { reverseGeocode } from "@/lib/geocode";
import { copyText } from "@/lib/copy-to-clipboard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TripFoodModule } from "@/components/trip-food-module";
import { UnifiedCalendarGrid } from "@/components/unified-calendar";
import { ReceiptsWallet } from "@/components/receipts/ReceiptsWallet";

type Tab = "announcement" | "receipts" | "encyclopedia";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TripAnnouncement = {
  trip_id: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
};

type TripItem = {
  id: string;
  trip_id: string;
  name: string;
  created_by: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

type UserItemCheck = {
  item_id: string;
  user_id: string;
  is_checked: boolean;
};

type TripPlan = {
  id: string;
  trip_id: string;
  time_label: string | null;
  location: string | null;
  activity: string | null;
  sequence: number;
  plan_date: string | null;
  plan_time: string | null;
  day_title: string | null;
};

// Cast supabase to any for tables not yet in generated types
const db = supabase as any;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function TripInfoModule({
  tripId,
  currentUserId,
}: {
  tripId: string;
  currentUserId: string | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [activeTab, setActiveTab] = useState<Tab>("announcement");

  return (
    <div className="mx-auto max-w-lg px-1 pb-10 pt-3">
      {/* 自适应收折型顶部 Tab 切换条 */}
      <div className="mb-5 flex w-full items-center gap-1.5 rounded-2xl border border-border bg-muted p-1">
        {/* Announcement Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("announcement")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-all duration-300",
            activeTab === "announcement"
              ? "border border-brand/50 bg-brand/15 text-brand"
              : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Megaphone className="h-4 w-4" />
          <span>{isEn ? "Announcement" : "公告"}</span>
        </button>

        {/* Receipts Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("receipts")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-all duration-300",
            activeTab === "receipts"
              ? "border border-brand/50 bg-brand/15 text-brand"
              : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <FileText className="h-4 w-4" />
          <span>{isEn ? "Receipts" : "票据"}</span>
        </button>

        {/* Encyclopedia Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("encyclopedia")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-all duration-300",
            activeTab === "encyclopedia"
              ? "border border-brand/50 bg-brand/15 text-brand"
              : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Compass className="h-4 w-4" />
          <span>{isEn ? "Encyclopedia" : "博物馆百科"}</span>
        </button>
      </div>

      {activeTab === "announcement" ? (
        <AnnouncementPanel tripId={tripId} currentUserId={currentUserId} />
      ) : activeTab === "receipts" ? (
        <ReceiptsWallet tripId={tripId} currentUserId={currentUserId} />
      ) : (
        <EncyclopediaPanel tripId={tripId} />
      )}
    </div>
  );
}

import { MuseumEncyclopedia } from "@/components/museum/MuseumEncyclopedia";

// ---------------------------------------------------------------------------
// Encyclopedia Panel (Museum Encyclopedia)
// ---------------------------------------------------------------------------
function EncyclopediaPanel({ tripId }: { tripId: string }) {
  return <MuseumEncyclopedia tripId={tripId} />;
}

// ---------------------------------------------------------------------------
// Itinerary Panel (multi-plan + timeline + manual add + Word import)
// ---------------------------------------------------------------------------
type TripPlanWithName = TripPlan & { plan_name?: string | null };

function ItineraryPanel({
  tripId,
  currentUserId: _currentUserId,
}: {
  tripId: string;
  currentUserId: string | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [plans, setPlans] = useState<TripPlanWithName[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // 时间选择器三元状态（替代单一 newTime 文本框）
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [preciseTime, setPreciseTime] = useState<string>("");
  const [newLocation, setNewLocation] = useState("");
  const [newActivity, setNewActivity] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 表单折叠面板状态（默认折叠，释放屏幕高度）
  const [isFormOpen, setIsFormOpen] = useState(false);

  // 行程卡片全局联动折叠状态：默认 false (全收起)
  // 点击任意卡片 Header 触发全局同步切换，所有卡片同时展开/收起
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /** 全局联动切换：全收起 ↔ 全展开
   *  从“全收起”切换到“全展开”时，延时滚动将触发点击的卡片置于屏幕中央 */
  const handleToggleAll = useCallback((clickedCardId: string) => {
    setIsAllExpanded((prev) => {
      const next = !prev;
      // 当前收起 (prev=false) → 即将展开 (next=true)，延时滚动至中央
      if (!prev && next) {
        setTimeout(() => {
          cardRefs.current[clickedCardId]?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 120);
      }
      return next;
    });
  }, []);

  // 行程编辑相关状态
  const [editingPlan, setEditingPlan] = useState<TripPlanWithName | null>(null);
  const [editDate, setEditDate] = useState<string>("");
  const [editPeriod, setEditPeriod] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [editPreciseTime, setEditPreciseTime] = useState<string>("");
  const [editLoc, setEditLoc] = useState<string>("");
  const [editAct, setEditAct] = useState<string>("");
  const [isEditCalendarOpen, setIsEditCalendarOpen] = useState(false);
  const [editCalendarViewDate, setEditCalendarViewDate] = useState<Date>(new Date());
  const [editDayTitle, setEditDayTitle] = useState<string>("");
  const [editCalendarMode, setEditCalendarMode] = useState<"day" | "month" | "year">("day");

  // 子分时弹窗状态
  const [subPlanTarget, setSubPlanTarget] = useState<{ date: string; dayTitle: string } | null>(null);
  const [subTime, setSubTime] = useState("");
  const [subPeriod, setSubPeriod] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [subLoc, setSubLoc] = useState("");
  const [subAct, setSubAct] = useState("");
  // 子弹窗日期选择：默认继承母分项日期，允许用户跨日期自由调整
  const [subDate, setSubDate] = useState<string>("");
  // 子弹窗日历弹窗状态 — 复用 UnifiedCalendarGrid 暗夜青蓝风格
  const [isSubCalendarOpen, setIsSubCalendarOpen] = useState(false);
  const [subCalendarMode, setSubCalendarMode] = useState<"day" | "month" | "year">("day");
  const [subCalendarViewDate, setSubCalendarViewDate] = useState<Date>(new Date());

  // 天主题修改状态（弹窗模式 — 已废弃，改用 inlineThemeEdit 内联编辑）
  const [editingDayTheme, setEditingDayTheme] = useState<{ date: string; title: string } | null>(null);
  const [newDayThemeInput, setNewDayThemeInput] = useState("");

  // Day Card 日期批量修改状态
  const [editingDayDate, setEditingDayDate] = useState<string | null>(null);
  const [tempNewDayDate, setTempNewDayDate] = useState<string>("");
  const [isDayDateCalendarOpen, setIsDayDateCalendarOpen] = useState(false);
  const [dayDateCalendarView, setDayDateCalendarView] = useState<Date>(new Date());
  const [dayDateCalendarMode, setDayDateCalendarMode] = useState<"day" | "month" | "year">("day");

  // Day Card 主题内联编辑状态
  const [inlineThemeEdit, setInlineThemeEdit] = useState<{ date: string; value: string } | null>(null);

  // 自定义日历弹窗状态
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"day" | "month" | "year">("day");
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(new Date());
  const calendarRef = useRef<HTMLDivElement>(null);

  // 月份多语言常量（星期常量已由 UnifiedCalendarGrid 内部维护）
  const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];


  // 点击外部自动收起日历
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 多计划管理状态 — 零状态冷启动：默认空数组与空激活方案
  const [activePlan, setActivePlan] = useState<string>("");
  const [planNames, setPlanNames] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 方案统一操作弹窗状态（合并新建、复制、重命名）
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [planModalMode, setPlanModalMode] = useState<"create" | "copy" | "rename">("create");
  const [planModalInput, setPlanModalInput] = useState("");
  const [planModalOldName, setPlanModalOldName] = useState("");

  // 自定义确认弹窗状态（替代原生 confirm()，避免 iframe 沙箱拦截导致 React error #185）
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: "clear" | "delete" | "delete-item";
    title: string;
    message: string;
    itemId?: string;
  }>({
    isOpen: false,
    type: "clear",
    title: "",
    message: "",
  });

  const DEFAULT_PLAN = "PLAN A";

  // 获取所有计划 — 纯净提取 DB 方案名，不硬编码注入 PLAN A
  // 使用函数式更新避免依赖 activePlan，防止创建方案后 Realtime useEffect 重新订阅导致方案消失
  const loadPlans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db
      .from("trip_plans")
        .select("id, trip_id, time_label, location, activity, sequence, plan_date, plan_time, day_title, plan_name")
        .eq("trip_id", tripId)
        .order("sequence", { ascending: true })
        .limit(100);
    if (!error && data) {
      const list = (data ?? []) as TripPlanWithName[];
      setPlans(list);
      // 只提取数据库中实际存在的方案名，不进行任何硬编码注入
      const names = Array.from(new Set(list.map((p) => p.plan_name).filter(Boolean))) as string[];
      setPlanNames(names);

      // 使用函数式更新避免依赖 activePlan — 防止创建方案后 loadPlans 引用变化触发 Realtime 重订阅
      if (names.length > 0) {
        setActivePlan((current) => {
          if (!current || !names.includes(current)) {
            return names[0];
          }
          return current;
        });
      } else {
        setActivePlan("");
      }
    }
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // Realtime
  useEffect(() => {
    const channel = db
      .channel(`itinerary:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_plans",
          filter: `trip_id=eq.${tripId}`,
        },
        () => loadPlans(),
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [tripId, loadPlans]);

  // 切换计划时强制关闭所有编辑/添加框，防止从计划 A 切到计划 B 时表单依然展开
  useEffect(() => {
    setIsFormOpen(false);
    setEditingPlan(null);
    setSubPlanTarget(null);
    setEditingDayTheme(null);
    setEditingDayDate(null);
    setInlineThemeEdit(null);
  }, [activePlan]);

  // 当前激活方案下的行程列表
  const currentPlanItems = plans.filter(
    (p) => (p.plan_name || DEFAULT_PLAN) === activePlan,
  );

  // 中文数字序数转换辅助函数
  const getOrdinalDay = (index: number, en: boolean) => {
    if (en) return `Day ${index}`;
    const chineseNums = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];
    const numStr = chineseNums[index - 1] || String(index);
    return `第${numStr}天 (Day ${index})`;
  };

  // 从 time_label 中提取粗略时段（Morning/Afternoon/Evening 等），用于卡片显示——禁止拼接日期
  const getPeriodFromLabel = (label: string | null): string => {
    if (!label) return "";
    if (isEn) {
      if (label.includes("Morning")) return "Morning";
      if (label.includes("Afternoon")) return "Afternoon";
      if (label.includes("Evening")) return "Evening";
    } else {
      if (label.includes("上午")) return "上午";
      if (label.includes("下午")) return "下午";
      if (label.includes("晚上")) return "晚上";
    }
    return "";
  };

  // 按天分组聚合与排序算法
  const getGroupedPlans = () => {
    const grouped: { [key: string]: TripPlanWithName[] } = {};

    currentPlanItems.forEach((plan) => {
      const dateKey = plan.plan_date || "TBD";
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(plan);
    });

    // 日期升序排列，未确定日期（TBD）放最后
    const sortedDateKeys = Object.keys(grouped).sort((a, b) => {
      if (a === "TBD") return 1;
      if (b === "TBD") return -1;
      return new Date(a).getTime() - new Date(b).getTime();
    });

    return sortedDateKeys.map((dateKey, index) => {
      const items = grouped[dateKey];

      // 同一天内按 plan_time 升序排列
      items.sort((a, b) => {
        const timeA = a.plan_time || "99:99";
        const timeB = b.plan_time || "99:99";
        return timeA.localeCompare(timeB);
      });

      // 抓取本组中第一个有效的 day_title
      const groupDayTitle = items.find((item) => item.day_title)?.day_title || "";

      // 格式化日期头显示
      let displayDate = dateKey;
      if (dateKey !== "TBD") {
        const d = new Date(dateKey + "T00:00:00");
        displayDate = isEn
          ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
          : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      } else {
        displayDate = isEn ? "Unscheduled" : "待定日期";
      }

      return {
        dateKey,
        dayLabel: dateKey !== "TBD" ? getOrdinalDay(index + 1, isEn) : (isEn ? "TBD" : "日期未定"),
        // 纯数字天数（用于 Day 圆圈简化显示），TBD 时为 null
        dayNumber: dateKey !== "TBD" ? index + 1 : null,
        displayDate,
        groupDayTitle,
        items,
      };
    });
  };

  // Add plan manually (绑定到当前激活方案) — 智能串联日期+时间段+精准时间，自适应中英文
  const handleAdd = async () => {
    if (adding) return;
    const activity = newActivity.trim();
    const location = newLocation.trim();
    if (!activity && !location && !selectedDate) return;

    // 1. 智能格式化日期，适配中英双语
    let formattedTimeLabel = "";
    if (selectedDate) {
      const dateObj = new Date(selectedDate + "T00:00:00");
      if (isEn) {
        // 英文格式: "Sep 17 (Thu)"
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const month = months[dateObj.getMonth()];
        const date = dateObj.getDate();
        const dayOfWeek = days[dateObj.getDay()];
        formattedTimeLabel = `${month} ${date} (${dayOfWeek})`;
      } else {
        // 中文格式: "9月17日 (周四)"
        const month = dateObj.getMonth() + 1;
        const date = dateObj.getDate();
        const dayOfWeek = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dateObj.getDay()];
        formattedTimeLabel = `${month}月${date}日 (${dayOfWeek})`;
      }
    }

    // 2. 追加时间段（自适应中英文）
    if (selectedPeriod) {
      const periodMap = isEn
        ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
        : { morning: "上午", afternoon: "下午", evening: "晚上" };
      formattedTimeLabel += ` ${periodMap[selectedPeriod]}`;
    }

    // 3. 追加精确时刻
    if (preciseTime.trim()) {
      formattedTimeLabel += ` ${preciseTime.trim()}`;
    }

    // 兜底：如果用户完全没选时间，默认为"待定"
    if (!formattedTimeLabel) {
      formattedTimeLabel = isEn ? "To Be Decided" : "待定";
    }

    setAdding(true);
    const nextSeq =
      currentPlanItems.length > 0
        ? Math.max(...currentPlanItems.map((p) => p.sequence)) + 1
        : 0;
    const { data, error } = await db
      .from("trip_plans")
      .insert({
          trip_id: tripId,
          time_label: formattedTimeLabel,
          location: location || null,
          activity: activity || null,
          sequence: nextSeq,
          plan_name: activePlan,
        })
        .select("id, trip_id, time_label, location, activity, sequence, plan_date, plan_time, day_title, plan_name")
        .single();
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPlans((prev) => [...prev, data as TripPlanWithName]);
    // 清空所有输入并自动折叠表单
    setSelectedDate("");
    setSelectedPeriod("");
    setPreciseTime("");
    setNewLocation("");
    setNewActivity("");
    setIsFormOpen(false);
  };

  // Delete single plan item
  const handleDelete = async (id: string) => {
    const { error } = await db.from("trip_plans").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPlans((prev) => prev.filter((p) => p.id !== id));
  };

  // 触发编辑：回显已有数据并智能识别时间段
  const handleStartEdit = (plan: TripPlanWithName) => {
    setEditingPlan(plan);
    setEditDate(plan.plan_date || "");
    setEditLoc(plan.location || "");
    setEditAct(plan.activity || "");
    setEditPreciseTime(plan.plan_time || "");
    setEditDayTitle(plan.day_title || "");
    setEditCalendarMode("day");

    // 从已有的 time_label 中智能提取时间段
    if (plan.time_label?.includes("上午") || plan.time_label?.includes("Morning")) {
      setEditPeriod("morning");
    } else if (plan.time_label?.includes("下午") || plan.time_label?.includes("Afternoon")) {
      setEditPeriod("afternoon");
    } else if (plan.time_label?.includes("晚上") || plan.time_label?.includes("Evening")) {
      setEditPeriod("evening");
    } else {
      setEditPeriod("");
    }

    if (plan.plan_date) {
      setEditCalendarViewDate(new Date(plan.plan_date + "T00:00:00"));
    } else {
      setEditCalendarViewDate(new Date());
    }
  };

  // 编辑弹窗日历三模式翻页逻辑
  const handleEditPrev = () => {
    const year = editCalendarViewDate.getFullYear();
    const month = editCalendarViewDate.getMonth();
    if (editCalendarMode === "day") {
      setEditCalendarViewDate(new Date(year, month - 1, 1));
    } else if (editCalendarMode === "month") {
      setEditCalendarViewDate(new Date(year - 1, month, 1));
    } else {
      setEditCalendarViewDate(new Date(year - 10, month, 1));
    }
  };

  const handleEditNext = () => {
    const year = editCalendarViewDate.getFullYear();
    const month = editCalendarViewDate.getMonth();
    if (editCalendarMode === "day") {
      setEditCalendarViewDate(new Date(year, month + 1, 1));
    } else if (editCalendarMode === "month") {
      setEditCalendarViewDate(new Date(year + 1, month, 1));
    } else {
      setEditCalendarViewDate(new Date(year + 10, month, 1));
    }
  };

  const handleEditHeaderTitleClick = () => {
    if (editCalendarMode === "day") {
      setEditCalendarMode("month");
    } else if (editCalendarMode === "month") {
      setEditCalendarMode("year");
    }
  };

  // 提交修改：重新拼装日期标签并更新落库
  const handleUpdatePlan = async () => {
    if (!editingPlan) return;

    let formattedTimeLabel = "";

    if (editDate) {
      const dateObj = new Date(editDate + "T00:00:00");
      if (isEn) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        formattedTimeLabel = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
      } else {
        formattedTimeLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
      }
    }

    if (editPeriod) {
      const periodMap = isEn
        ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
        : { morning: "上午", afternoon: "下午", evening: "晚上" };
      formattedTimeLabel += ` ${periodMap[editPeriod]}`;
    }

    if (editPreciseTime.trim()) {
      formattedTimeLabel += ` ${editPreciseTime.trim()}`;
    }

    if (!formattedTimeLabel) {
      formattedTimeLabel = isEn ? "To Be Decided" : "待定";
    }

    try {
      const { error } = await db
        .from("trip_plans")
        .update({
          plan_date: editDate || null,
          plan_time: editPreciseTime || null,
          time_label: formattedTimeLabel,
          location: editLoc || null,
          activity: editAct || null,
        })
        .eq("id", editingPlan.id);

      if (error) throw error;

      // 更新本地状态
      setPlans((prev) =>
        prev.map((p) =>
          p.id === editingPlan.id
            ? {
                ...p,
                plan_date: editDate || null,
                plan_time: editPreciseTime || null,
                time_label: formattedTimeLabel,
                location: editLoc || null,
                activity: editAct || null,
              }
            : p,
        ),
      );
      setEditingPlan(null);
      toast.success(isEn ? "Updated successfully" : "行程更新成功");
    } catch (err: any) {
      console.error("更新失败:", err);
      toast.error(err?.message ?? (isEn ? "Update failed" : "更新失败"));
    }
  };

  // 添加子分时行程（自动继承母分项的天标题，日期可由用户在弹窗中自由调整）
  const handleAddSubPlan = async () => {
    if (!subPlanTarget || !subLoc.trim()) return;

    let formattedTimeLabel = "";

    // 优先使用弹窗中用户选择的日期，无则回退到母分项日期
    const effectiveDate = subDate && subDate !== "TBD" ? subDate : (subPlanTarget.date !== "TBD" ? subPlanTarget.date : "");
    if (effectiveDate) {
      const dateObj = new Date(effectiveDate + "T00:00:00");
      if (isEn) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        formattedTimeLabel = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
      } else {
        formattedTimeLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
      }
    }

    // 优先使用精确时间，否则使用粗略时段
    if (subTime.trim()) {
      formattedTimeLabel += ` ${subTime.trim()}`;
    } else if (subPeriod) {
      const periodMap = isEn
        ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
        : { morning: "上午", afternoon: "下午", evening: "晚上" };
      formattedTimeLabel += ` ${periodMap[subPeriod]}`;
    }

    if (!formattedTimeLabel) {
      formattedTimeLabel = isEn ? "To Be Decided" : "待定";
    }

    try {
      const nextSeq =
        currentPlanItems.length > 0
          ? Math.max(...currentPlanItems.map((p) => p.sequence)) + 1
          : 0;
      const { data, error } = await db
        .from("trip_plans")
        .insert({
          trip_id: tripId,
          plan_name: activePlan,
          plan_date: effectiveDate || null,
          plan_time: subTime.trim() || null,
          time_label: formattedTimeLabel,
          day_title: subPlanTarget.dayTitle || null,
          location: subLoc.trim(),
          activity: subAct.trim() || null,
          sequence: nextSeq,
        })
        .select("id, trip_id, time_label, location, activity, sequence, plan_date, plan_time, day_title, plan_name")
        .single();

      if (error) throw error;

      setPlans((prev) => [...prev, data as TripPlanWithName]);
      setSubTime("");
      setSubPeriod("");
      setSubLoc("");
      setSubAct("");
      setSubDate("");
      setSubPlanTarget(null);
      toast.success(isEn ? "Sub-item added" : "子行程添加成功");
    } catch (err: any) {
      console.error("添加子行程失败:", err);
      toast.error(err?.message ?? (isEn ? "Failed to add" : "添加失败"));
    }
  };

  // 批量更新当日主题（同步更新该日期该方案下所有行程的 day_title）
  const handleUpdateDayTheme = async (planDate: string, newDayTitle: string) => {
    try {
      const trimmedTitle = newDayTitle.trim();
      const { error } = await db
        .from("trip_plans")
        .update({ day_title: trimmedTitle || null })
        .eq("trip_id", tripId)
        .eq("plan_name", activePlan)
        .eq("plan_date", planDate);

      if (error) throw error;

      // 本地批量更新，无刷新秒响应
      setPlans((prev) =>
        prev.map((p) =>
          p.plan_date === planDate && (p.plan_name || DEFAULT_PLAN) === activePlan
            ? { ...p, day_title: trimmedTitle || null }
            : p,
        ),
      );

      setEditingDayTheme(null);
      setInlineThemeEdit(null);
      toast.success(isEn ? "Day theme updated" : "当日主题更新成功");
    } catch (err: any) {
      console.error("更新天主题失败:", err);
      toast.error(err?.message ?? (isEn ? "Update failed" : "更新失败"));
    }
  };

  // 批量更新当日日期（级联更新该日期下所有行程项的 plan_date）
  const handleBatchUpdateDayDate = async (oldDate: string, newDate: string) => {
    if (!oldDate || !newDate || oldDate === newDate) {
      setEditingDayDate(null);
      return;
    }
    try {
      const { error } = await db
        .from("trip_plans")
        .update({ plan_date: newDate })
        .eq("trip_id", tripId)
        .eq("plan_name", activePlan)
        .eq("plan_date", oldDate);

      if (error) throw error;

      // 本地批量更新
      setPlans((prev) =>
        prev.map((p) =>
          p.plan_date === oldDate && (p.plan_name || DEFAULT_PLAN) === activePlan
            ? { ...p, plan_date: newDate }
            : p,
        ),
      );

      setEditingDayDate(null);
      setIsDayDateCalendarOpen(false);
      toast.success(isEn ? "Day date updated" : "日期已批量更新");
    } catch (err: any) {
      console.error("批量更新日期失败:", err);
      toast.error(err?.message ?? (isEn ? "Update failed" : "更新失败"));
    }
  };

  // 新建方案 — 点击 + New 弹出命名输入框
  const handleCreateNewPlan = () => {
    setPlanModalMode("create");
    setPlanModalInput("");
    setIsPlanModalOpen(true);
  };

  // 复制当前方案
  // 触发打开"复制方案"弹窗（替代原生 prompt）
  const handleCopyPlan = () => {
    setPlanModalMode("copy");
    setPlanModalInput(`${activePlan} - Copy`);
    setIsPlanModalOpen(true);
  };

  // 弹窗确认提交逻辑（新建/复制/重命名统一入口）
  const handlePlanModalSubmit = async () => {
    const trimmed = planModalInput.trim();
    if (!trimmed) return;

    if (planModalMode === "create") {
      // 新建方案排重校验
      if (planNames.includes(trimmed)) {
        toast.error(t("itinerary.plan_name_exists") || "该计划名称已存在！");
        return;
      }
      setPlanNames((prev) => [...prev, trimmed]);
      setActivePlan(trimmed);
      setIsPlanModalOpen(false);
      toast.success(t("itinerary.plan_created") || "新方案已创建");
    } else if (planModalMode === "copy") {
      // 复制方案排重校验
      if (planNames.includes(trimmed)) {
        toast.error(t("itinerary.plan_name_exists") || "该计划名称已存在！");
        return;
      }
      if (currentPlanItems.length > 0) {
        setCopying(true);
        const copiedItems = currentPlanItems.map((item) => ({
          trip_id: tripId,
          time_label: item.time_label,
          location: item.location,
          activity: item.activity,
          sequence: item.sequence,
          plan_name: trimmed,
        }));
        const { error } = await db.from("trip_plans").insert(copiedItems);
        setCopying(false);
        if (error) {
          toast.error(error.message);
          return;
        }
        await loadPlans();
        toast.success(t("itinerary.plan_copied") || "方案已复制");
      } else {
        setPlanNames((prev) => [...prev, trimmed]);
      }
      setActivePlan(trimmed);
      setIsPlanModalOpen(false);
    } else {
      // ===== 重命名分支 =====
      const oldName = planModalOldName;
      if (trimmed === oldName) {
        setIsPlanModalOpen(false);
        return;
      }
      // 重命名排重校验
      if (planNames.includes(trimmed)) {
        toast.error(t("itinerary.plan_name_exists") || "该计划名称已存在！");
        return;
      }
      const prevNames = planNames;
      const prevActive = activePlan;
      try {
        // 1. 乐观更新本地状态
        setPlanNames((prev) => prev.map((name) => (name === oldName ? trimmed : name)));
        setActivePlan(trimmed);

        // 2. 批量修改云端 — 若旧名为 PLAN A，同步洗掉 NULL 旧行
        let query = db.from("trip_plans").update({ plan_name: trimmed }).eq("trip_id", tripId);
        if (oldName === DEFAULT_PLAN) {
          query = query.or(`plan_name.eq."${oldName}",plan_name.is.null`);
        } else {
          query = query.eq("plan_name", oldName);
        }
        const { error } = await query;
        if (error) throw error;

        // 3. 全局刷新
        await loadPlans();
        setIsPlanModalOpen(false);
        toast.success(isEn ? "Plan renamed successfully" : "方案名称修改成功");
      } catch (err) {
        console.error(err);
        setPlanNames(prevNames);
        setActivePlan(prevActive);
        toast.error(isEn ? "Failed to rename, reverted to original" : "重命名失败，已恢复原名称");
      }
    }
  };

  // 触发清空确认弹窗（替代原生 confirm）
  const triggerClearConfirm = () => {
    if (!activePlan) {
      toast.info(t("itinerary.already_empty") || "请先选择一个方案");
      return;
    }
    if (currentPlanItems.length === 0) {
      toast.info(t("itinerary.already_empty") || "当前方案已经是空的");
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: "clear",
      title: t("itinerary.clear_plan") || "清空方案内容",
      message:
        t("itinerary.confirm_clear", { plan: activePlan }) ||
        `确定要清空当前方案 [${activePlan}] 中的所有行程安排吗？此操作将清除该方案下的全部内容，但保留方案标签。`,
    });
  };

  // 触发删除确认弹窗（替代原生 confirm）
  const triggerDeleteConfirm = () => {
    if (!activePlan) {
      toast.error(t("itinerary.must_keep_one") || "请先选择一个方案！");
      return;
    }
    setConfirmModal({
      isOpen: true,
      type: "delete",
      title: t("itinerary.delete_plan") || "彻底删除方案",
      message:
        t("itinerary.confirm_delete_plan", { plan: activePlan }) ||
        `确定要彻底删除方案 [${activePlan}] 及其中的所有行程吗？此操作不可逆！`,
    });
  };

  // 统一弹窗确认提交处理函数
  const handleConfirmSubmit = async () => {
    const { type, itemId } = confirmModal;
    // 立即关闭弹窗
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));

    if (type === "delete-item") {
      // 删除单个行程项（从编辑弹窗触发）
      if (itemId) {
        await handleDelete(itemId);
        setEditingPlan(null);
      }
      return;
    }

    if (type === "clear") {
      setClearing(true);
      try {
        const { error } = await db
          .from("trip_plans")
          .delete()
          .eq("trip_id", tripId)
          .eq("plan_name", activePlan);
        if (error) throw error;
        setPlans((prev) => prev.filter((p) => (p.plan_name || DEFAULT_PLAN) !== activePlan));
        toast.success(t("itinerary.plan_cleared") || "方案内容已清空");
      } catch (err: any) {
        console.error("清空方案失败:", err);
        toast.error(err?.message ?? "清空失败");
      } finally {
        setClearing(false);
      }
    } else if (type === "delete") {
      setDeleting(true);
      try {
        const { error } = await db
          .from("trip_plans")
          .delete()
          .eq("trip_id", tripId)
          .eq("plan_name", activePlan);
        if (error) throw error;

        const remainingPlans = planNames.filter((name) => name !== activePlan);
        setPlanNames(remainingPlans);

        const fallbackPlan = remainingPlans[0] || "";
        setActivePlan(fallbackPlan);

        setPlans((prev) => prev.filter((p) => (p.plan_name || DEFAULT_PLAN) !== activePlan));
        toast.success(
          t("itinerary.plan_deleted", { plan: activePlan }) || `方案 [${activePlan}] 已删除`,
        );
      } catch (err: any) {
        console.error("删除方案失败:", err);
        toast.error(err?.message ?? "删除失败");
      } finally {
        setDeleting(false);
      }
    }
  };

  // Import from Word — 智能日期/时间/天标题结构化解析
  const handleImportWord = async (file: File | undefined) => {
    if (!file || importing) return;
    const lowerName = file.name.toLowerCase();
    const isDocx = lowerName.endsWith(".docx");
    const isMd = lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || lowerName.endsWith(".txt");
    if (!isDocx && !isMd) {
      toast.error(isEn ? "Please upload a .docx or .md file" : "请上传 .docx 或 .md 文件");
      return;
    }
    setImporting(true);
    try {
      // 1. 提取纯文本：.docx 用 mammoth，.md/.txt 直接读取
      let text: string;
      if (isDocx) {
        text = await extractTextFromDocx(file);
      } else {
        text = await file.text();
      }

      // 2. 调用统一结构化解析器（支持 # 大标题 / Day X: 日期（2026年9月16日 / 2026-09-16 / Sep 16, 2026）/ ## 每日主题 / [HH:MM] 节点 / [行程|策略|备注|提示] 或 [Itinerary|Strategy|Notes|Tips] 卡片 / --- 分隔符）
      const parsed = parseStructuredItinerary(text);

      if (parsed.days.length === 0) {
        toast.error(isEn ? "No itinerary content found" : "未找到行程内容");
        setImporting(false);
        return;
      }

      // 3. 扁平化为 trip_plans 表结构
      const parsedPlans = flattenToTripPlans(parsed, {
        tripId,
        planName: activePlan,
        startSequence: 0,
      });

      if (parsedPlans.length === 0) {
        toast.error(isEn ? "No itinerary content found" : "未找到行程内容");
        setImporting(false);
        return;
      }

      const { data, error } = await db
        .from("trip_plans")
        .insert(parsedPlans)
        .select("id, trip_id, time_label, location, activity, sequence, plan_date, plan_time, day_title, plan_name");
      if (error) throw error;
      setPlans((prev) => [...prev, ...((data ?? []) as TripPlanWithName[])]);
      toast.success(
        isEn
          ? `Successfully imported ${parsedPlans.length} items${parsed.tripTitle ? ` (${parsed.tripTitle})` : ""}!`
          : `成功导入了 ${parsedPlans.length} 项旅行计划${parsed.tripTitle ? `（${parsed.tripTitle}）` : ""}！`,
      );
    } catch (err: any) {
      console.error("Word import failed:", err);
      toast.error(err?.message ?? (isEn ? "Import failed" : "导入失败"));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶层：方案选择与管理条（z-10 pointer-events-auto 确保点击不被遮挡） */}
      <div className="relative z-10 pointer-events-auto rounded-2xl border border-border bg-muted/60 p-3">
        <div className="flex flex-col gap-3">
          {/* 方案 Tabs 切换：flex-wrap 自动折行，拒绝横向滚动条 */}
          <div className="flex flex-wrap items-center gap-2 w-full">
            {planNames.map((name) => {
              const isSelected = activePlan === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setPlanModalMode("rename");
                      setPlanModalOldName(name);
                      setPlanModalInput(name);
                      setIsPlanModalOpen(true);
                    } else {
                      setActivePlan(name);
                    }
                  }}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-1 rounded-full px-5 py-2 text-xs font-bold transition-all duration-200",
                    isSelected
                      ? "bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] cursor-pointer group/pill"
                      : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                  title={isSelected ? (isEn ? "Click to rename" : "点击修改此方案名称") : undefined}
                >
                  <span>{name}</span>
                  {isSelected && <Pencil className="h-2.5 w-2.5 text-brand-foreground opacity-60 transition-opacity group-hover/pill:opacity-100" />}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleCreateNewPlan}
              aria-label={t("itinerary.new_plan") || "新建"}
              className="flex flex-shrink-0 items-center justify-center rounded-full bg-brand p-2 text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)] transition-all hover:bg-brand/90"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 管理操作：导入留在左侧，其余纯 Icon 按钮推到右侧 */}
          <div className="flex items-center w-full gap-2 sm:gap-3 overflow-x-auto flex-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border-t border-border pt-3">
            {/* 1. Word 导入按钮（保持文字+Icon） */}
            <label
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 rounded-full border border-border/50 bg-card/80 px-4 py-1.5 text-sm text-foreground transition-all hover:text-brand hover:border-brand/50",
                !activePlan
                  ? "cursor-not-allowed opacity-30 pointer-events-none"
                  : "cursor-pointer",
              )}
              title={isEn ? `Import Word to [${activePlan}]` : `导入 Word 行程至 [${activePlan}]`}
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{isEn ? "Import" : "导入 Word"}</span>
              {activePlan && (
                <input
                  ref={fileRef}
                  type="file"
                  accept=".docx,.md,.markdown,.txt"
                  className="hidden"
                  onChange={(e) => handleImportWord(e.target.files?.[0])}
                  disabled={importing}
                />
              )}
            </label>

            {/* 右侧纯 Icon 按钮组 */}
            <div className="ml-auto flex items-center gap-2">
              {/* 2. 复制此方案 */}
              <button
                type="button"
                onClick={handleCopyPlan}
                disabled={copying || !activePlan}
                title={isEn ? "Copy Plan" : "复制此方案"}
                className="flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full border border-border/50 bg-card/80 p-2 text-foreground transition-all hover:text-brand hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {copying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>

              {/* 3. 一键清空内容 */}
              <button
                type="button"
                onClick={triggerClearConfirm}
                disabled={clearing || !activePlan}
                title={isEn ? "Clear All" : "一键清空"}
                className="flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full border border-border/50 bg-card/80 p-2 text-foreground transition-all hover:text-brand hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {clearing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eraser className="w-4 h-4" />
                )}
              </button>

              {/* 4. 彻底删除此方案 */}
              <button
                type="button"
                onClick={triggerDeleteConfirm}
                disabled={deleting || !activePlan}
                title={isEn ? "Delete Plan" : "彻底删除此方案"}
                className="flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full border border-border/50 bg-card/80 p-2 text-foreground transition-all hover:text-brand hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 精巧的【添加行程】控制开关按钮 — 仅当行程内容为空时显示 */}
      {currentPlanItems.length === 0 && (
        <button
          type="button"
          onClick={() => setIsFormOpen(!isFormOpen)}
          disabled={!activePlan}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted py-2.5 text-xs font-semibold text-foreground transition-all duration-200 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
        >
          {isFormOpen ? (
            <span>{isEn ? "- Collapse Form" : "- 收起添加表单"}</span>
          ) : (
            <span>{isEn ? "Add Itinerary" : "添加新行程"}</span>
          )}
        </button>
      )}

      {/* 手动新增行程表单：仅在 isFormOpen === true 时显示 */}
      {isFormOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-4 animate-[fadeIn_0.2s_ease-out_forwards]">
          {/* 第一行：时间设置组合拳 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* 自定义日历选择组合 */}
            <div ref={calendarRef} className="relative">
              {/* 触发按钮 */}
              <button
                type="button"
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted px-3 text-left text-xs text-foreground transition-all hover:border-brand/40"
              >
                <span>
                  {selectedDate
                    ? isEn
                      ? `${MONTHS_EN[new Date(selectedDate + "T00:00:00").getMonth()]} ${new Date(selectedDate + "T00:00:00").getDate()}`
                      : `${new Date(selectedDate + "T00:00:00").getMonth() + 1}月${new Date(selectedDate + "T00:00:00").getDate()}日`
                    : isEn
                      ? "Select Date"
                      : "选择日期"}
                </span>
                <CalendarDays className="h-3.5 w-3.5 text-brand" />
              </button>

              {/* 日历弹出框 — 统一接入 UnifiedCalendarGrid（暗夜青蓝风格，无遮罩层避免卡顿） */}
              {isCalendarOpen && (
                <UnifiedCalendarGrid
                  mode={calendarMode}
                  viewDate={calendarViewDate}
                  selectedDateStr={selectedDate}
                  setMode={setCalendarMode}
                  setViewDate={setCalendarViewDate}
                  onSelectDate={(dateStr) => {
                    setSelectedDate(dateStr);
                    setIsCalendarOpen(false);
                  }}
                  labelText={isEn ? "SELECT DATE" : "选择日期"}
                  isEn={isEn}
                  zIndexClass="z-50"
                />
              )}
            </div>

            {/* 上午/下午/晚上 快速选择药丸（与精确时间互斥 — 填了时间则置灰禁用） */}
            <div className="flex items-center gap-2">
              {(["morning", "afternoon", "evening"] as const).map((period) => {
                const labelMap = isEn
                  ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
                  : { morning: "上午", afternoon: "下午", evening: "晚上" };
                const isSelected = selectedPeriod === period;
                const hasPreciseTime = preciseTime.trim().length > 0;
                return (
                  <button
                    key={period}
                    type="button"
                    disabled={hasPreciseTime}
                    onClick={() => {
                      setSelectedPeriod(isSelected ? "" : period);
                      if (!isSelected) setPreciseTime("");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                      hasPreciseTime
                        ? "bg-muted text-muted-foreground cursor-not-allowed opacity-40"
                        : isSelected
                          ? "bg-brand text-brand-foreground"
                          : "bg-brand/15 text-brand hover:bg-brand/20",
                    )}
                  >
                    {labelMap[period]}
                  </button>
                );
              })}
            </div>

            {/* 精准时间输入填空（与粗略时段互斥 — 选了时段则置灰禁用） */}
            <input
              type="text"
              value={preciseTime}
              onChange={(e) => {
                setPreciseTime(e.target.value);
                if (e.target.value) setSelectedPeriod("");
              }}
              disabled={!!selectedPeriod}
              placeholder={isEn ? "Precise Time (e.g., 10:00)" : "具体时刻选填 (如 10:00)"}
              maxLength={20}
              className={cn(
                "h-9 w-full rounded-lg border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30",
                selectedPeriod && "opacity-40 cursor-not-allowed",
              )}
            />
          </div>

          {/* 第二行：地点、活动与提交按钮 */}
          <div className="grid grid-cols-1 gap-3 border-t border-border pt-2 md:grid-cols-3">
            <input
              type="text"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder={isEn ? "Location" : "地点 (如 米兰大教堂)"}
              maxLength={255}
              className="h-9 w-full rounded-lg border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30"
            />
            <div className="flex gap-2 md:col-span-2">
              <input
                type="text"
                value={newActivity}
                onChange={(e) => setNewActivity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                placeholder={isEn ? "Activity notes..." : "活动描述/备忘..."}
                maxLength={2000}
                className="h-9 flex-1 rounded-lg border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={adding || (!newActivity.trim() && !newLocation.trim() && !selectedDate)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)] transition-all hover:bg-brand/90 disabled:opacity-40"
              >
                {adding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 计划按天聚合卡片时间轴列表 */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : getGroupedPlans().length === 0 ? (
        <div className="py-8" />
      ) : (
        <div className="space-y-6">
          {getGroupedPlans().map((group) => (
            <div key={group.dateKey} className="space-y-3">
              {/* Day 头部 — 无衬底纯净效果 */}
              <div>
                {/* 第一行：Day 圆圈数字 + 日期（左） + 添加按钮（右），justify-between 两端对齐 */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                  {/* Day 圆圈：纯数字，w-9 h-9，加粗 */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/15 text-base font-bold text-brand">
                    {group.dayNumber ?? "?"}
                  </div>
                  {/* 日期 — 可点击唤起轻量级日历 Popover（无遮罩层，一步保存） */}
                  {group.dateKey !== "TBD" ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          // 再次点击则收起
                          if (editingDayDate === group.dateKey && isDayDateCalendarOpen) {
                            setEditingDayDate(null);
                            setIsDayDateCalendarOpen(false);
                            return;
                          }
                          setEditingDayDate(group.dateKey);
                          setTempNewDayDate(group.dateKey);
                          setDayDateCalendarView(new Date(group.dateKey + "T00:00:00"));
                          setDayDateCalendarMode("day");
                          setIsDayDateCalendarOpen(true);
                        }}
                        className="text-sm text-foreground cursor-pointer hover:text-brand transition-colors"
                        title={isEn ? "Click to change date" : "点击修改日期"}
                      >
                        {group.displayDate}
                      </button>
                      {/* 轻量级日历 Popover — 绝对定位浮层，无背景遮罩，选中即保存 */}
                      {editingDayDate === group.dateKey && isDayDateCalendarOpen && (
                        <UnifiedCalendarGrid
                          mode={dayDateCalendarMode}
                          viewDate={dayDateCalendarView}
                          selectedDateStr={tempNewDayDate}
                          setMode={setDayDateCalendarMode}
                          setViewDate={setDayDateCalendarView}
                          onSelectDate={(dateStr) => {
                            // 一步到位：选中即触发批量保存并关闭
                            handleBatchUpdateDayDate(group.dateKey, dateStr);
                          }}
                          labelText={isEn ? "NEW DATE" : "新日期"}
                          isEn={isEn}
                          zIndexClass="z-50"
                        />
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{group.displayDate}</span>
                  )}
                  </div>
                  {/* 单日节点添加按钮 — w-9 h-9 匹配 Day 圆圈尺寸，留足触控空间 */}
                  <button
                    type="button"
                    onClick={() => {
                      setSubPlanTarget({ date: group.dateKey, dayTitle: group.groupDayTitle });
                      // 初始化子弹窗日期为当前 Day 的日期，允许用户跨日期自由调整
                      setSubDate(group.dateKey !== "TBD" ? group.dateKey : "");
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-brand"
                    title={isEn ? "Add item" : "添加当日行程"}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {/* 第二行：当日主题 — 居中纯文本，无图标，字号放大加粗纯白 */}
                {inlineThemeEdit?.date === group.dateKey ? (
                  /* 编辑状态：居中 input + Check 保存 + X 取消 */
                  <div className="my-2 flex items-center justify-center gap-2 w-full">
                    <input
                      value={inlineThemeEdit.value}
                      onChange={(e) => setInlineThemeEdit({ date: group.dateKey, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdateDayTheme(group.dateKey, inlineThemeEdit.value);
                        if (e.key === "Escape") setInlineThemeEdit(null);
                      }}
                      className="bg-card border border-brand/50 text-brand text-lg font-bold text-center px-3 py-1 rounded-full w-48 focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateDayTheme(group.dateKey, inlineThemeEdit.value)}
                      className="p-1 bg-brand/20 text-brand rounded-full hover:bg-brand/40 transition-colors shrink-0"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInlineThemeEdit(null)}
                      className="p-1 bg-red-500/20 text-red-400 rounded-full hover:bg-red-500/40 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  /* 默认状态：居中纯文本主题，无图标，字号放大加粗纯白 */
                  <button
                    type="button"
                    onClick={() => setInlineThemeEdit({ date: group.dateKey, value: group.groupDayTitle || "" })}
                    className="my-2 w-full whitespace-normal break-words leading-snug px-3 text-center text-lg font-bold text-foreground transition-colors hover:text-brand"
                    title={isEn ? "Click to edit theme" : "点击编辑主题"}
                  >
                    {group.groupDayTitle || (isEn ? "+ Theme" : "+ 主题")}
                  </button>
                )}
              </div>

              {/* 行程时间段卡片堆叠 — 每个时间段独立气泡框，无时间线 */}
              <div className="flex flex-col gap-3">
                {group.items.map((plan) => {
                  // 全局联动：所有卡片共用 isAllExpanded 状态
                  const isExpanded = isAllExpanded;
                  return (
                    <div
                      key={plan.id}
                      ref={(el) => {
                        cardRefs.current[plan.id] = el;
                      }}
                      className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:border-border"
                    >
                      {/* 顶部时间标头与标题 — 点击触发全局联动切换 */}
                      <div
                        onClick={() => handleToggleAll(plan.id)}
                        className="flex items-center justify-between gap-2 cursor-pointer select-none hover:bg-muted/40 -m-1 p-1 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 时间胶囊：优先显示精确时间，无则从 time_label 提取粗略时段——禁止拼接日期 */}
                          {(plan.plan_time || getPeriodFromLabel(plan.time_label)) && (
                            <span className="rounded bg-brand/20 text-brand font-mono text-xs px-2 py-0.5 font-semibold">
                              {plan.plan_time || getPeriodFromLabel(plan.time_label)}
                            </span>
                          )}
                          {/* 标题文字 */}
                          {plan.location && (
                            <h4 className="text-base font-bold text-foreground">
                              {plan.location}
                            </h4>
                          )}
                        </div>
                        {/* 右侧只保留折叠/展开指示箭头 */}
                        <div className="flex items-center gap-2 shrink-0">
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 text-muted-foreground transition-transform duration-300",
                              isExpanded ? "rotate-180" : "",
                            )}
                          />
                        </div>
                      </div>
                      {/* 展开内容区：正文 + 右下角编辑按钮 */}
                      {isExpanded && (
                        <div className="mt-2 border-t border-border/50 pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          {plan.activity && (
                            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed pr-8">
                              {plan.activity}
                            </p>
                          )}
                          {/* 右下角编辑按钮 */}
                          <div className="mt-2 flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation(); // 阻止触发全局联动切换
                                handleStartEdit(plan);
                              }}
                              className="p-2 rounded-xl bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-all active:scale-95 border border-border/50"
                              aria-label={isEn ? "Edit" : "编辑"}
                              title={isEn ? "Edit" : "编辑"}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

            {/* 方案统一命名弹窗（新建/复制/重命名三合一，磨砂玻璃风 + 弹性入场动画） */}
      {isPlanModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out_forwards]"
          onClick={() => setIsPlanModalOpen(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-[scaleUp_0.25s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-foreground">
              <span>
                {planModalMode === "create"
                  ? t("itinerary.new_plan_title") || "新建旅行方案"
                  : planModalMode === "rename"
                    ? isEn ? "Rename Plan" : "修改方案名称"
                    : t("itinerary.copy_plan_title", { plan: activePlan }) || `复制方案 (${activePlan})`}
              </span>
            </h3>

            <input
              type="text"
              value={planModalInput}
              onChange={(e) => setPlanModalInput(e.target.value)}
              placeholder={isEn ? "Plan Name (e.g., Gourmet Route)" : "方案名称 (如：环线行程、特种兵美食)"}
              maxLength={100}
              className="mb-6 w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground font-sans focus:outline-none focus:ring-2 focus:ring-brand/40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePlanModalSubmit();
              }}
            />

            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-foreground transition-all hover:text-foreground"
              >
                {t("common.cancel") || "取消"}
              </button>
              <button
                type="button"
                onClick={handlePlanModalSubmit}
                disabled={!planModalInput.trim() || copying}
                aria-label={t("common.confirm") || "确认"}
                className="flex items-center justify-center rounded-full bg-brand p-3 text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 自定义确认模态弹窗（替代原生 confirm，磨砂玻璃风 + 弹性入场动画） */}
      {confirmModal.isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_forwards]"
          onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-lg font-bold text-foreground">
              {confirmModal.title}
            </h3>
            <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
              {confirmModal.message}
            </p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-foreground transition-all hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                className={`rounded-full px-4 py-1.5 font-semibold text-white transition-all ${
                  confirmModal.type === "delete" || confirmModal.type === "delete-item"
                    ? "bg-rose-600 shadow-lg shadow-rose-950/50 hover:bg-rose-500"
                    : "bg-amber-600 shadow-lg shadow-amber-950/50 hover:bg-amber-500"
                }`}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 行程编辑自定义模态弹窗 — UI 对齐票据模块：操作栏右上角 + Label 统一样式 */}
      {editingPlan && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_forwards]"
          onClick={() => setEditingPlan(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部：标题左侧 + 删除/保存按钮右侧（对齐票据编辑弹窗布局） */}
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                <Pencil className="h-4 w-4 text-brand" />
                <span>{isEn ? "Edit Itinerary" : "修改行程安排"}</span>
              </h3>
              <div className="flex items-center gap-2">
                {/* 删除按钮 — 触发确认弹窗防误触 */}
                <button
                  type="button"
                  onClick={() => {
                    if (!editingPlan) return;
                    setConfirmModal({
                      isOpen: true,
                      type: "delete-item",
                      title: isEn ? "Delete Item" : "删除行程项",
                      message: isEn
                        ? "Are you sure you want to delete this itinerary item?"
                        : "确定要删除此行程项吗？此操作不可逆。",
                      itemId: editingPlan.id,
                    });
                  }}
                  className="flex items-center justify-center rounded-full border border-red-500/30 bg-red-500/15 p-2.5 text-red-400 transition-all hover:bg-red-500/25"
                  aria-label={isEn ? "Delete" : "删除"}
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                {/* 保存按钮 — 青蓝发光软盘 */}
                <button
                  type="button"
                  onClick={handleUpdatePlan}
                  aria-label={isEn ? "Save" : "保存修改"}
                  className="flex items-center justify-center rounded-full bg-brand p-2.5 text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90"
                >
                  <Save className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* 1. 日期选择 */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "DATE" : "日期"}
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsEditCalendarOpen(!isEditCalendarOpen)}
                    className="flex h-9 w-full items-center justify-between rounded-xl border border-border/50 bg-card/80 px-3 text-left text-xs text-foreground transition-all hover:border-brand"
                  >
                    <span>
                      {editDate
                        ? isEn
                          ? `${MONTHS_EN[new Date(editDate + "T00:00:00").getMonth()]} ${new Date(editDate + "T00:00:00").getDate()}, ${new Date(editDate + "T00:00:00").getFullYear()}`
                          : `${new Date(editDate + "T00:00:00").getFullYear()}年${new Date(editDate + "T00:00:00").getMonth() + 1}月${new Date(editDate + "T00:00:00").getDate()}日`
                        : isEn
                          ? "Select Date"
                          : "选择日期"}
                    </span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>

                  {/* 统一日历弹出框 — 三维视图穿梭 */}
                  {isEditCalendarOpen && (
                    <>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditCalendarOpen(false);
                        }}
                        className="fixed inset-0 z-[65] bg-black/60"
                      />
                      <UnifiedCalendarGrid
                        mode={editCalendarMode}
                        viewDate={editCalendarViewDate}
                        selectedDateStr={editDate}
                        setMode={setEditCalendarMode}
                        setViewDate={setEditCalendarViewDate}
                        onSelectDate={(dateStr) => {
                          setEditDate(dateStr);
                          setIsEditCalendarOpen(false);
                        }}
                        labelText={isEn ? "EDIT DATE" : "修改日期"}
                        isEn={isEn}
                        zIndexClass="z-[70]"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* 2. 精确时刻 — 与粗略时段互斥（选了时段则置灰禁用） */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "PRECISE TIME" : "具体时刻"}
                </label>
                <input
                  type="text"
                  value={editPreciseTime}
                  onChange={(e) => {
                    setEditPreciseTime(e.target.value);
                    if (e.target.value) setEditPeriod("");
                  }}
                  disabled={!!editPeriod}
                  placeholder={isEn ? "Precise Time (e.g., 10:00)" : "具体时刻选填 (如 10:00)"}
                  maxLength={20}
                  className={cn(
                    "h-9 w-full rounded-xl border border-border/50 bg-card/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none",
                    editPeriod && "opacity-40 cursor-not-allowed",
                  )}
                />
              </div>

              {/* 3. 上午/下午/晚上 Toggle — 与精确时间互斥（填了时间则置灰禁用） */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "TIME PERIOD" : "时段"}
                </label>
                <div className="flex items-center gap-2">
                  {(["morning", "afternoon", "evening"] as const).map((period) => {
                    const labelMap = isEn
                      ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
                      : { morning: "上午", afternoon: "下午", evening: "晚上" };
                    const isSelected = editPeriod === period;
                    const hasEditPreciseTime = editPreciseTime.trim().length > 0;
                    return (
                      <button
                        key={period}
                        type="button"
                        disabled={hasEditPreciseTime}
                        onClick={() => {
                          setEditPeriod(isSelected ? "" : period);
                          if (!isSelected) setEditPreciseTime("");
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                          hasEditPreciseTime
                            ? "bg-muted text-muted-foreground cursor-not-allowed opacity-40"
                            : isSelected
                              ? "bg-brand text-brand-foreground"
                              : "bg-brand/15 text-brand hover:bg-brand/20",
                        )}
                      >
                        {labelMap[period]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. 行程地点 */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "LOCATION" : "行程地点"}
                </label>
                <input
                  type="text"
                  value={editLoc}
                  onChange={(e) => setEditLoc(e.target.value)}
                  placeholder={isEn ? "Location" : "地点 (如 米兰大教堂)"}
                  maxLength={255}
                  className="h-9 w-full rounded-xl border border-border/50 bg-card/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>

              {/* 5. 活动详情 */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "ACTIVITY DETAILS" : "活动描述/备忘"}
                </label>
                <textarea
                  value={editAct}
                  onChange={(e) => setEditAct(e.target.value)}
                  rows={3}
                  placeholder={isEn ? "Activity notes..." : "活动描述/备忘..."}
                  maxLength={2000}
                  className="w-full resize-none rounded-xl border border-border/50 bg-card/80 px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
            {/* 底部按钮已移至头部右上角 */}
          </div>
        </div>
      )}

      {/* 添加子分时模态弹窗 */}
      {subPlanTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_forwards]"
          onClick={() => setSubPlanTarget(null)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              {/* DATE 日期选择 — 复用 UnifiedCalendarGrid 暗夜青蓝风格，替代原生白底 DatePicker */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "DATE" : "日期"}
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (subDate) setSubCalendarViewDate(new Date(subDate + "T00:00:00"));
                      setSubCalendarMode("day");
                      setIsSubCalendarOpen(!isSubCalendarOpen);
                    }}
                    className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted px-3 text-left text-sm text-foreground transition-all hover:border-brand/40"
                  >
                    <span>
                      {subDate
                        ? isEn
                          ? `${MONTHS_EN[new Date(subDate + "T00:00:00").getMonth()]} ${new Date(subDate + "T00:00:00").getDate()}, ${new Date(subDate + "T00:00:00").getFullYear()}`
                          : `${new Date(subDate + "T00:00:00").getFullYear()}年${new Date(subDate + "T00:00:00").getMonth() + 1}月${new Date(subDate + "T00:00:00").getDate()}日`
                        : isEn
                          ? "Select Date"
                          : "选择日期"}
                    </span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>
                  {isSubCalendarOpen && (
                    <>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSubCalendarOpen(false);
                        }}
                        className="fixed inset-0 z-[65] bg-black/60"
                      />
                      <UnifiedCalendarGrid
                        mode={subCalendarMode}
                        viewDate={subCalendarViewDate}
                        selectedDateStr={subDate}
                        setMode={setSubCalendarMode}
                        setViewDate={setSubCalendarViewDate}
                        onSelectDate={(dateStr) => {
                          setSubDate(dateStr);
                          setIsSubCalendarOpen(false);
                        }}
                        labelText={isEn ? "SELECT DATE" : "选择日期"}
                        isEn={isEn}
                        zIndexClass="z-[70]"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* 粗略时段胶囊（与精确时间互斥） */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "TIME PERIOD" : "时段"}
                </label>
                <div className="flex items-center gap-2">
                  {(["morning", "afternoon", "evening"] as const).map((period) => {
                    const labelMap = isEn
                      ? { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
                      : { morning: "上午", afternoon: "下午", evening: "晚上" };
                    const isSelected = subPeriod === period;
                    const hasPreciseTime = subTime.trim().length > 0;
                    return (
                      <button
                        key={period}
                        type="button"
                        disabled={hasPreciseTime}
                        onClick={() => {
                          setSubPeriod(isSelected ? "" : period);
                          if (!isSelected) setSubTime("");
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                          hasPreciseTime
                            ? "bg-muted text-muted-foreground cursor-not-allowed opacity-40"
                            : isSelected
                              ? "bg-brand text-brand-foreground"
                              : "bg-brand/15 text-brand hover:bg-brand/20",
                        )}
                      >
                        {labelMap[period]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 具体时刻（与粗略时段互斥 — 选了时段则置灰禁用） */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "PRECISE TIME" : "具体时刻"}
                </label>
                <input
                  type="text"
                  value={subTime}
                  onChange={(e) => {
                    setSubTime(e.target.value);
                    if (e.target.value) setSubPeriod("");
                  }}
                  disabled={!!subPeriod}
                  placeholder={isEn ? "Time (e.g., 14:30)" : "具体时刻选填 (如 14:30)"}
                  maxLength={20}
                  className={cn(
                    "h-9 w-full rounded-lg border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30",
                    subPeriod && "opacity-40 cursor-not-allowed",
                  )}
                />
              </div>

              {/* 行程地点（必填） */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "LOCATION (REQUIRED)" : "行程地点 (必填)"}
                </label>
                <input
                  type="text"
                  value={subLoc}
                  onChange={(e) => setSubLoc(e.target.value)}
                  placeholder={isEn ? "Location" : "行程地点..."}
                  maxLength={255}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30"
                />
              </div>

              {/* 活动详情 */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "ACTIVITY DETAILS" : "活动描述/备忘"}
                </label>
                <textarea
                  value={subAct}
                  onChange={(e) => setSubAct(e.target.value)}
                  rows={2}
                  placeholder={isEn ? "Activity notes..." : "活动描述/备忘..."}
                  maxLength={2000}
                  className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30"
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4 text-xs">
              <button
                type="button"
                onClick={() => setSubPlanTarget(null)}
                className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-foreground transition-all hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleAddSubPlan}
                disabled={!subLoc.trim()}
                aria-label={isEn ? "Add" : "添加"}
                className="flex items-center justify-center rounded-full bg-brand p-3 text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day Card 日期 Popover 已内联至日期按钮下方，无需独立弹窗 */}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all duration-200",
        active
          ? "border border-brand/50 bg-brand/15 text-brand"
          : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Announcement Panel
// ---------------------------------------------------------------------------
function AnnouncementPanel({
  tripId,
  currentUserId,
}: {
  tripId: string;
  currentUserId: string | null;
}) {
  const t = useT();
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 默认只读浏览态：点击右下角铅笔才进入编辑
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 编辑态 Textarea 自适应高度：内容增长时撑开跟随页面伸展，杜绝内嵌滚动条
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !isEditing) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, isEditing]);

  // Load announcement
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await db
        .from("trip_announcements")
        .select("content")
        .eq("trip_id", tripId)
        .maybeSingle();
      if (!cancelled) {
        if (!error && data) {
          setContent((data as TripAnnouncement).content || "");
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // Realtime: listen for updates from other users
  useEffect(() => {
    const channel = db
      .channel(`announcement:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_announcements",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload: any) => {
          const row = payload.new as TripAnnouncement | null;
          if (!row) return;
          const newContent = row.content || "";
          // 仅浏览态同步远端内容；编辑态草稿不受干扰，避免覆盖正在输入的文字
          if (!isEditing) setContent(newContent);

          if (row.updated_by && row.updated_by !== currentUserId) {
            const preview =
              newContent.length > 60
                ? newContent.slice(0, 60) + "…"
                : newContent;
            toast.custom(
              () => (
                <div
                  className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-card/90 px-4 py-3 shadow-xl backdrop-blur-xl"
                  style={{
                    boxShadow:
                      "0 0 24px rgba(45,212,191,0.15), 0 8px 32px rgba(0,0,0,0.4)",
                  }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                    <Megaphone className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-primary">
                      {t("announcement_updated_toast")}
                    </div>
                    {preview && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {preview}
                      </div>
                    )}
                  </div>
                </div>
              ),
              { duration: 4000 },
            );
          }
        },
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [tripId, currentUserId, t, isEditing]);

  // 右下角铅笔 → 进入编辑态，草稿以当前内容初始化
  const handleStartEdit = () => {
    setDraft(content);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const trimmed = draft.trim();
    const { error } = await db
      .from("trip_announcements")
      .upsert(
        {
          trip_id: tripId,
          content: trimmed,
          updated_by: currentUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trip_id" },
      );
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      setContent(trimmed);
      setIsEditing(false);
      toast.success(t("announcement_updated_toast"));
    }
  };

  return (
    <div className="pb-6">
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("announcement_placeholder")}
              maxLength={2000}
              autoFocus
              className="w-full resize-none overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-sm focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30 transition-colors"
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm leading-relaxed text-slate-900 dark:text-slate-100 shadow-sm whitespace-pre-wrap break-words">
              {content || (
                <span className="text-slate-400 dark:text-slate-500">
                  {t("announcement_placeholder")}
                </span>
              )}
            </div>
          )}

          {/* 卡片正下方右侧操作按钮（内容流布局）：内容短时紧贴卡片右下角，
              内容长时随页面自然滚动、始终跟随在文字末尾
              浅色模式 = 品牌深青绿；深色模式 = 荧光青蓝 */}
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={isEditing ? handleSave : handleStartEdit}
              disabled={saving}
              aria-label={isEditing ? t("common.save") : t("common.edit")}
              title={isEditing ? t("common.save") : t("common.edit")}
              className="flex items-center justify-center w-12 h-12 rounded-full bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-700/20 dark:bg-cyan-400 dark:hover:bg-cyan-300 dark:text-slate-950 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isEditing ? (
                <Save className="w-5 h-5" />
              ) : (
                <Pencil className="w-5 h-5" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist Panel (with independent user checks)
// ---------------------------------------------------------------------------
function ChecklistPanel({
  tripId,
  currentUserId,
  tripName,
}: {
  tripId: string;
  currentUserId: string | null;
  /** 行程名称 — 用于导出文件命名（${tripName}_物品清单.txt） */
  tripName?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [items, setItems] = useState<TripItem[]>([]);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState("");
  const [adding, setAdding] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // ── 工具栏状态：文档导入 / 重置打勾 / 清空清单 ──
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Load items + my checks
  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: itemData, error: itemErr } = await db
      .from("trip_items")
      .select("id, trip_id, name, created_by, city, latitude, longitude, created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (itemErr) {
      toast.error(itemErr.message);
      setLoading(false);
      return;
    }
    const itemList = (itemData ?? []) as TripItem[];
    setItems(itemList);

    if (currentUserId && itemList.length > 0) {
      const { data: checkData } = await db
        .from("user_item_checks")
        .select("item_id, user_id, is_checked")
        .eq("user_id", currentUserId)
        .in(
          "item_id",
          itemList.map((i: TripItem) => i.id),
        );
      const checkedSet = new Set<string>();
      for (const c of (checkData ?? []) as UserItemCheck[]) {
        if (c.is_checked) checkedSet.add(c.item_id);
      }
      setChecks(checkedSet);
    }
    setLoading(false);
  }, [tripId, currentUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: listen for new/deleted items and check updates
  useEffect(() => {
    const channel = db
      .channel(`checklist:${tripId}:${currentUserId ?? "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_items",
          filter: `trip_id=eq.${tripId}`,
        },
        () => loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "trip_items",
        },
        () => loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_item_checks",
        },
        () => loadData(),
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [tripId, currentUserId, loadData]);

  // Add item
  const handleAdd = async () => {
    const name = newItemName.trim();
    if (!name || adding || !currentUserId) return;
    setAdding(true);
    const { data, error } = await db
      .from("trip_items")
      .insert({
        trip_id: tripId,
        name,
        created_by: currentUserId,
        city: "",
        latitude: null,
        longitude: null,
      })
      .select("id, trip_id, name, created_by, city, latitude, longitude, created_at")
      .single();
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const newItem = data as TripItem;
    setItems((prev) => [...prev, newItem]);
    setNewItemName("");
    toast.success(isEn ? "Item added!" : "物品添加成功！");
  };

  // Update item name
  const handleUpdateItem = async (itemId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      toast.error(isEn ? "Item name cannot be empty" : "物品名称不能为空");
      return;
    }

    const { error } = await db
      .from("trip_items")
      .update({ name: trimmedName, updated_at: new Date().toISOString() })
      .eq("id", itemId);

    if (error) {
      toast.error(error.message);
      return;
    }

    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, name: trimmedName } : item)));
    toast.success(isEn ? "Item updated!" : "物品更新成功！");
  };

  // Delete item
  const handleDelete = async (itemId: string) => {
    try {
      // 关键：链式 .select() 返回实际删除的行。
      // RLS 拒绝时 Supabase 不返回 error，而是静默删除 0 行，必须靠返回行数识别
      const { data: deleted, error } = await db
        .from("trip_items")
        .delete()
        .eq("id", itemId)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error(
          isEn
            ? "Delete blocked: no permission or item not found (check RLS policy)"
            : "删除被拦截：无删除权限或物品不存在（请检查 RLS 策略）",
        );
      }

      // 1. 乐观更新：强制类型转换，立即从界面移除
      setItems((prev) => prev.filter((i) => String(i.id) !== String(itemId)));
      setChecks((prev) => {
        const next = new Set(prev);
        next.delete(String(itemId));
        return next;
      });

      // 2. 强制刷新：重新拉取数据库，确保数据 100% 同步（等价于 invalidateQueries）
      await loadData();

      toast.success(isEn ? "Deleted successfully" : "删除成功");
    } catch (err: any) {
      console.error("Delete failed:", err);
      // 错误显式化：绝不静默吞掉报错
      toast.error(err?.message ?? (isEn ? "Delete failed" : "删除失败"));
      // 删除失败时回滚界面状态，恢复服务器真实数据
      await loadData();
    }
  };

  // Toggle check (independent per user)
  const handleToggleCheck = async (itemId: string) => {
    if (!currentUserId) return;
    const isCurrentlyChecked = checks.has(itemId);
    setUpdatingId(itemId);
    setChecks((prev) => {
      const next = new Set(prev);
      if (isCurrentlyChecked) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

    const { error } = await db
      .from("user_item_checks")
      .upsert(
        {
          item_id: itemId,
          user_id: currentUserId,
          is_checked: !isCurrentlyChecked,
        },
        { onConflict: "item_id,user_id" },
      );
    setUpdatingId(null);
    if (error) {
      setChecks((prev) => {
        const next = new Set(prev);
        if (isCurrentlyChecked) next.add(itemId);
        else next.delete(itemId);
        return next;
      });
      toast.error(error.message);
    }
  };

  // ── 工具栏：文档导入（txt/md 纯文本逐行解析，docx 走 mammoth 提取）──
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!currentUserId) {
      toast.error(isEn ? "Please sign in first" : "请先登录");
      return;
    }
    setImporting(true);
    try {
      let text: string;
      if (file.name.toLowerCase().endsWith(".docx")) {
        text = await extractTextFromDocx(file);
      } else {
        text = await file.text();
      }
      // 逐行清洗：去首尾空白 → 去复选框（- [ ]）→ 去项目符号（- • · *）→ 去序号（1. / 1、/ 1)）
      const names = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .map((l) =>
          l
            .replace(/^\[[ xX]?\]\s*/, "")
            .replace(/^[-•·*]\s*/, "")
            .replace(/^\d+[.、)）]\s*/, "")
            .trim(),
        )
        .filter((l) => l.length > 0 && l.length <= 500)
        .slice(0, 200);
      if (names.length === 0) {
        toast.error(isEn ? "No items found in the document" : "文档中未解析到任何物品");
        return;
      }
      const rows = names.map((name) => ({
        trip_id: tripId,
        name,
        created_by: currentUserId,
        city: "",
        latitude: null,
        longitude: null,
      }));
      const { data, error } = await db
        .from("trip_items")
        .insert(rows)
        .select("id, trip_id, name, created_by, city, latitude, longitude, created_at");
      if (error) throw error;
      setItems((prev) => [...prev, ...((data ?? []) as TripItem[])]);
      toast.success(isEn ? `Imported ${names.length} items` : `成功导入 ${names.length} 件物品`);
    } catch (err: any) {
      console.error("[Checklist] import failed:", err);
      toast.error(err?.message || (isEn ? "Import failed" : "导入失败"));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  // 清单纯文本（导出与复制共用）：每行一件物品
  const buildListText = () => items.map((i) => i.name).join("\n");

  // ── 工具栏：导出 txt（${tripName}_物品清单.txt）──
  const handleExport = () => {
    if (items.length === 0) {
      toast.warning(isEn ? "Nothing to export yet" : "清单为空，暂无可导出内容");
      return;
    }
    const blob = new Blob([buildListText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (tripName || tripId).replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "trip";
    const suffix = isEn ? "PackingList" : "物品清单";
    a.href = url;
    a.download = `${safeName}_${suffix}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(isEn ? "Packing list exported" : "物品清单已导出");
  };

  // ── 工具栏：一键复制清单文字到剪贴板 ──
  const handleCopyList = async () => {
    if (items.length === 0) {
      toast.warning(isEn ? "Nothing to copy yet" : "清单为空，暂无可复制内容");
      return;
    }
    const ok = await copyText(buildListText());
    if (ok) {
      toast.success(isEn ? "Copied to clipboard" : "已复制到剪贴板");
    } else {
      toast.error(isEn ? "Copy failed" : "复制失败");
    }
  };

  // ── 工具栏：清除打勾（仅重置完成状态，保留全部物品内容）──
  const handleResetChecks = async () => {
    if (!currentUserId || resetting) return;
    if (checks.size === 0) {
      toast.info(isEn ? "No checked items yet" : "当前没有已打勾的物品");
      return;
    }
    setResetting(true);
    try {
      const rows = [...checks].map((item_id) => ({
        item_id,
        user_id: currentUserId,
        is_checked: false,
      }));
      const { error } = await db
        .from("user_item_checks")
        .upsert(rows, { onConflict: "item_id,user_id" });
      if (error) throw error;
      setChecks(new Set());
      toast.success(isEn ? "Check states reset" : "已重置全部打勾状态");
    } catch (err: any) {
      toast.error(err?.message || (isEn ? "Reset failed" : "重置失败"));
    } finally {
      setResetting(false);
    }
  };

  // ── 工具栏：清空清单（二次确认后彻底删除全部物品）──
  const handleClearAll = async () => {
    if (items.length === 0 || clearing) return;
    setClearing(true);
    try {
      // 链式 .select() 识别 RLS 静默拦截（删除 0 行时返回空数组）
      const { data: deleted, error } = await db
        .from("trip_items")
        .delete()
        .eq("trip_id", tripId)
        .select("id");
      if (error) throw error;
      const n = deleted?.length ?? 0;
      if (n < items.length) {
        toast.warning(
          isEn
            ? `Deleted ${n}/${items.length}; some items blocked by permission`
            : `已删除 ${n}/${items.length} 件（部分物品无删除权限）`,
        );
      } else {
        toast.success(isEn ? "Cleared all items" : "已清空全部物品");
      }
      setItems([]);
      setChecks(new Set());
    } catch (err: any) {
      console.error("[Checklist] clear all failed:", err);
      toast.error(err?.message || (isEn ? "Clear failed" : "清空失败"));
    } finally {
      setClearing(false);
      setConfirmClearAll(false);
      await loadData();
    }
  };

  // 计算打包进度
  const completedCount = checks.size;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ── 操作工具栏：左侧导入/导出胶囊按钮 + 右侧复制/清除打勾/清空图标按钮 ── */}
      <div className="flex items-center justify-between gap-2">
        {/* 左侧：胶囊按钮组 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title={isEn ? "Import list document" : "导入物品清单文档"}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-all hover:border-brand/40 hover:bg-brand/10 disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            ) : (
              <Download className="h-3.5 w-3.5 text-brand" />
            )}
            {isEn ? "Import" : "导入"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={items.length === 0}
            title={isEn ? "Export as .txt" : "导出为 .txt 文件"}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-all hover:border-brand/40 hover:bg-brand/10 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5 text-brand" />
            {isEn ? "Export" : "导出"}
          </button>
        </div>

        {/* 右侧：图标按钮组（复制 / 清除打勾 / 清空清单） */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyList}
            disabled={items.length === 0}
            title={isEn ? "Copy list" : "复制清单文字"}
            aria-label={isEn ? "Copy list" : "复制清单"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-brand/40 hover:bg-brand/10 hover:text-foreground disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetChecks}
            disabled={resetting || checks.size === 0}
            title={isEn ? "Reset check states (keep items)" : "清除打勾（保留物品）"}
            aria-label={isEn ? "Reset checks" : "清除打勾"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-amber-400/50 hover:bg-amber-400/10 hover:text-amber-400 disabled:opacity-50"
          >
            {resetting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eraser className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearAll(true)}
            disabled={items.length === 0}
            title={isEn ? "Clear all items" : "清空全部物品"}
            aria-label={isEn ? "Clear all" : "清空清单"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 隐藏文件输入：物品清单文档导入（txt / md / docx） */}
      <input
        type="file"
        accept=".txt,.md,.docx,text/plain,text/markdown"
        ref={importInputRef}
        onChange={handleImportFile}
        className="hidden"
      />

      {/* 清空清单二次确认弹窗 */}
      <AlertDialog open={confirmClearAll} onOpenChange={(open) => !open && !clearing && setConfirmClearAll(false)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>{isEn ? "Clear All Items" : "清空全部物品"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isEn
                ? "Are you sure? This will permanently delete all packing list content."
                : "确定清空全部物品吗？此操作将删除所有清单内容"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleClearAll();
              }}
              disabled={clearing}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {clearing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isEn ? "Clear All" : "清空"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 进度条组件 - 精准放置在导航栏正下方 */}
      <div className="w-full bg-muted border border-border rounded-2xl p-3.5 flex flex-col gap-2">
        {/* 顶部文字 */}
        <div className="flex items-center justify-between text-xs font-bold text-brand">
          <span>{isEn ? "Packing Progress" : "打包进度"}</span>
          <span>{completedCount} / {totalCount}</span>
        </div>
        {/* 进度条轨道 */}
        <div className="bg-card h-2 rounded-full overflow-hidden">
          <div
            className="bg-brand shadow-[0_0_8px_rgba(0,242,254,0.6)] h-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 极简输入框容器 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={t("checklist.addItem")}
          maxLength={255}
          className="flex-1 rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/30"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newItemName.trim()}
          aria-label={isEn ? "Add" : "添加"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_14px_rgba(0,242,254,0.45)] transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {adding ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="w-5 h-5 text-brand-foreground" />
          )}
        </button>
      </div>

      {/* 极简清单项列表 — 随规划页面自然伸展，不做局部高度限制与滚动拦截 */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {isEn ? "No items yet. Add one above!" : "暂无物品，在上方添加一个吧！"}
          </p>
        ) : (
          items.map((item) => {
            const isChecked = checks.has(item.id);
            const isUpdating = updatingId === item.id;
            return (
              <ChecklistItem
                key={item.id}
                item={item}
                isChecked={isChecked}
                isUpdating={isUpdating}
                onToggleCheck={handleToggleCheck}
                onDelete={handleDelete}
                onUpdate={handleUpdateItem}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export { ChecklistPanel, ItineraryPanel };

// 独立的清单项组件，实现编辑状态控制
function ChecklistItem({
  item,
  isChecked,
  isUpdating,
  onToggleCheck,
  onDelete,
  onUpdate,
}: {
  item: TripItem;
  isChecked: boolean;
  isUpdating: boolean;
  onToggleCheck: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onUpdate: (itemId: string, newName: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [textValue, setTextValue] = useState(item.name);

  const handleSave = () => {
    if (textValue.trim()) {
      onUpdate(item.id, textValue);
      setIsEditing(false);
    } else {
      setTextValue(item.name);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setTextValue(item.name);
      setIsEditing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl p-3 transition-all",
        isChecked
          ? "border border-brand/50 bg-brand/10"
          : "border border-border bg-muted/60 hover:border-border",
      )}
    >
      <div className="flex items-center gap-3 flex-1">
        {/* Custom checkbox */}
        <button
          type="button"
          onClick={() => onToggleCheck(item.id)}
          disabled={isUpdating}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200",
            isChecked
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border bg-transparent hover:border-brand/60",
          )}
          aria-label={item.name}
        >
          {isChecked && <Check className="w-4 h-4 text-brand-foreground" />}
          {isUpdating && <Loader2 className="h-3 w-3 animate-spin" />}
        </button>

        {/* 文本区域：编辑态显示输入框，非编辑态显示文本 */}
        {isEditing ? (
          <input
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
          />
        ) : (
          <span
            className={cn(
              "text-sm font-medium transition-all",
              isChecked ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {item.name}
          </span>
        )}
      </div>

      {/* 右侧操作栏 */}
      {isEditing ? (
        /* 编辑态：显示保存与删除按钮 */
        <div className="flex items-center gap-2">
          <button
            type="button"
            // 阻止 mousedown 抢走输入框焦点：否则 onBlur 的 handleSave 先行触发并退出编辑态，
            // 按钮被卸载，click 永远无法送达
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleSave}
            title="保存修改"
            className="p-1.5 rounded-lg text-brand hover:bg-brand/10 transition-all"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(item.id);
            }}
            title="删除项目"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* 默认态：仅显示编辑图标 */
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          title="编辑项目"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-brand hover:bg-brand/10 transition-all"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
