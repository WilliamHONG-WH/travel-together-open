import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  UtensilsCrossed,
  ChefHat,
  Soup,
  Flame,
  Plus,
  Pencil,
  Trash2,
  Compass,
  Loader2,
  X,
  Check,
  CalendarDays,
  Download,
  Eraser,
  Save,
  ChevronDown,
  Store,
  Cake,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractDiningText, parseDiningDocument } from "@/lib/food-doc-parser";
import { geocodeVenue } from "@/lib/geocode";
import { useT, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { RestaurantsView } from "@/components/restaurants/RestaurantsView";
import {
  UnifiedCalendarGrid,
  MONTHS_EN,
  type CalendarMode,
} from "@/components/unified-calendar";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CourseType = "Starter" | "Main" | "Snack" | "Dessert";

type FoodPlan = {
  id: string;
  trip_id: string;
  plan_name: string | null;
  plan_date: string | null;
  day_title: string | null;
  course_type: CourseType | null;
  dish_name: string | null;
  description: string | null;
  sequence: number;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// 菜品多语言规范（前菜/主食/零食/甜点）— 含 Badge 专属配色
const FOOD_COURSES: { key: CourseType; zh: string; en: string; icon: typeof ChefHat; badgeCls: string }[] = [
  { key: "Starter", zh: "前菜", en: "Starter", icon: ChefHat, badgeCls: "bg-brand/10 text-brand border-brand/30" },
  { key: "Main", zh: "主食", en: "Main Course", icon: Soup, badgeCls: "bg-brand/10 text-brand border-brand/30" },
  { key: "Snack", zh: "零食", en: "Snack", icon: Flame, badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { key: "Dessert", zh: "甜点", en: "Dessert", icon: Cake, badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
];

// Cast supabase to any for tables not yet in generated types
const db = supabase as any;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function TripFoodModule({ tripId }: { tripId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [foodPlans, setFoodPlans] = useState<FoodPlan[]>([]);
  const [foodGuide, setFoodGuide] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [isFoodGuideModalOpen, setIsFoodGuideModalOpen] = useState(false);

  // 美食规划双视图：specialties = 特色菜（按天排布），restaurants = 餐厅网格（新视图）
  // 顶部三联 Tab 与方案管理操作卡片固定不变，仅切换下方内容区
  const [diningView, setDiningView] = useState<"specialties" | "restaurants">("specialties");
  // 餐厅视图刷新版本号：文档导入餐厅后递增，驱动 RestaurantsView 重新挂载取数
  const [restaurantsVersion, setRestaurantsVersion] = useState(0);

  // 美食卡片全局联动折叠状态：默认 false (全收起)
  // 点击任意卡片 Header 触发全局同步切换，所有卡片同时展开/收起
  const [isAllFoodExpanded, setIsAllFoodExpanded] = useState<boolean>(false);
  const foodCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /** 全局联动切换：全收起 ↔ 全展开
   *  从“全收起”切换到“全展开”时，延时滚动将触发点击的卡片置于屏幕中央 */
  const handleToggleAllFood = useCallback((clickedCardId: string) => {
    setIsAllFoodExpanded((prev) => {
      const next = !prev;
      // 当前收起 (prev=false) → 即将展开 (next=true)，延时滚动至中央
      if (!prev && next) {
        setTimeout(() => {
          foodCardRefs.current[clickedCardId]?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 120);
      }
      return next;
    });
  }, []);

  // Sub-food modal state
  const [subFoodTarget, setSubFoodTarget] = useState<{ date: string; dayTitle: string } | null>(null);
  const [subFoodCourse, setSubFoodCourse] = useState<CourseType>("Starter");
  const [subFoodName, setSubFoodName] = useState("");
  const [subFoodDesc, setSubFoodDesc] = useState("");
  const [addingFood, setAddingFood] = useState(false);
  // 子弹窗日期选择：默认继承母分项日期，允许用户跨日期自由调整
  const [subFoodDate, setSubFoodDate] = useState<string>("");
  // 子弹窗日历弹窗状态 — 复用 UnifiedCalendarGrid 暗夜青蓝风格
  const [isSubFoodCalendarOpen, setIsSubFoodCalendarOpen] = useState(false);
  const [subFoodCalendarMode, setSubFoodCalendarMode] = useState<"day" | "month" | "year">("day");
  const [subFoodCalendarViewDate, setSubFoodCalendarViewDate] = useState<Date>(new Date());

  // Edit food modal state
  const [editingFoodPlan, setEditingFoodPlan] = useState<FoodPlan | null>(null);
  const [editFoodName, setEditFoodName] = useState("");
  const [editFoodDesc, setEditFoodDesc] = useState("");
  const [editFoodCourse, setEditFoodCourse] = useState<CourseType>("Starter");
  const [updatingFood, setUpdatingFood] = useState(false);
  // 删除确认弹窗（替代原生 window.confirm）
  const [foodDeleteDialogOpen, setFoodDeleteDialogOpen] = useState(false);

  // Day theme modal state (弹窗模式 — 已废弃，改用 inlineFoodThemeEdit 内联编辑)
  const [editingFoodDayTheme, setEditingFoodDayTheme] = useState<{ date: string; title: string } | null>(null);
  const [newFoodDayThemeInput, setNewFoodDayThemeInput] = useState("");

  // Day Card 主题内联编辑状态
  const [inlineFoodThemeEdit, setInlineFoodThemeEdit] = useState<{ date: string; value: string } | null>(null);

  // Main food form state (collapsible top form)
  const [isFoodFormOpen, setIsFoodFormOpen] = useState(false);
  const [newFoodDate, setNewFoodDate] = useState<string>("");
  const [newFoodCourse, setNewFoodCourse] = useState<CourseType>("Starter");
  const [newFoodName, setNewFoodName] = useState("");
  const [newFoodDesc, setNewFoodDesc] = useState("");
  const [addingMainFood, setAddingMainFood] = useState(false);

  // Main food form calendar state
  const [isMainFoodCalendarOpen, setIsMainFoodCalendarOpen] = useState(false);
  const [mainFoodCalendarMode, setMainFoodCalendarMode] = useState<CalendarMode>("day");
  const [mainFoodCalendarViewDate, setMainFoodCalendarViewDate] = useState<Date>(new Date());

  // Food edit calendar state
  const [isFoodEditCalendarOpen, setIsFoodEditCalendarOpen] = useState(false);
  const [foodEditCalendarMode, setFoodEditCalendarMode] = useState<CalendarMode>("day");
  const [foodEditCalendarViewDate, setFoodEditCalendarViewDate] = useState<Date>(new Date());
  const [editFoodDate, setEditFoodDate] = useState<string>("");

  // Food multi-plan management state — 零状态冷启动
  const DEFAULT_FOOD_PLAN = "PLAN A";
  const [activeFoodPlan, setActiveFoodPlan] = useState<string>("");
  const [gastronomyPlans, setGastronomyPlans] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);

  // Food Word import state
  const [foodImporting, setFoodImporting] = useState(false);
  const foodFileRef = useRef<HTMLInputElement>(null);

  // Food unified confirmation modal state — scope 隔离特色菜/餐厅
  const [foodConfirmModal, setFoodConfirmModal] = useState<{
    isOpen: boolean;
    scope: "dishes" | "restaurants";
    title: string;
    message: string;
  }>({
    isOpen: false,
    scope: "dishes",
    title: "",
    message: "",
  });

  // Trigger clear confirmation modal — 按子视图分流：餐厅 ↔ 特色菜（互不影响）
  const triggerClearConfirmFood = async () => {
    if (diningView === "restaurants") {
      // 餐厅视图：仅清空 trip_restaurants
      const { count } = await db
        .from("trip_restaurants")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", tripId);
      if (!count) {
        toast.info(isEn ? "No restaurants to clear" : "当前没有餐厅数据可清空");
        return;
      }
      setFoodConfirmModal({
        isOpen: true,
        scope: "restaurants",
        title: isEn ? "Clear Restaurants" : "清空精选餐厅",
        message: isEn
          ? "Are you sure you want to clear ALL restaurants in this trip? Dishes data will NOT be affected."
          : "确定清空所有精选餐厅吗？此操作将删除本行程的全部餐厅数据，不会影响特色菜数据。",
      });
      return;
    }
    // 特色菜视图：仅清空当前方案的 trip_food_plans
    if (!activeFoodPlan) {
      toast.info(isEn ? "Please select a plan first" : "请先选择一个方案");
      return;
    }
    const currentItems = foodPlans.filter((p) => p.plan_name === activeFoodPlan);
    if (currentItems.length === 0) {
      toast.info(isEn ? "Current plan is already empty" : "当前方案已经是空的");
      return;
    }
    setFoodConfirmModal({
      isOpen: true,
      scope: "dishes",
      title: isEn ? "Clear Dishes" : "清空特色菜",
      message: isEn
        ? `Are you sure you want to clear all dishes in [${activeFoodPlan}]? This will remove all dishes but keep the plan label.`
        : `确定清空当前方案 [${activeFoodPlan}] 中的所有特色菜吗？此操作将清除该方案下的全部特色菜，但保留方案标签。`,
    });
  };

  // Unified confirmation submit — scope 隔离：餐厅分支不触动特色菜，反之亦然
  const handleConfirmFoodSubmit = async () => {
    const { scope } = foodConfirmModal;
    setFoodConfirmModal((prev) => ({ ...prev, isOpen: false }));

    // ===== 餐厅分支：仅操作 trip_restaurants，严禁触动 trip_food_plans =====
    if (scope === "restaurants") {
      setClearing(true);
      try {
        const { error } = await db.from("trip_restaurants").delete().eq("trip_id", tripId);
        if (error) throw error;
        // 递增版本号驱动 RestaurantsView 重新挂载取数
        setRestaurantsVersion((v) => v + 1);
        toast.success(isEn ? "Restaurants cleared" : "餐厅数据已清空");
      } catch (err: any) {
        console.error(err);
        toast.error(err?.message ?? (isEn ? "Operation failed" : "操作失败"));
      } finally {
        setClearing(false);
      }
      return;
    }

    // ===== 特色菜分支：仅操作 trip_food_plans =====
    setClearing(true);
    try {
      const { error } = await db
        .from("trip_food_plans")
        .delete()
        .eq("trip_id", tripId)
        .eq("plan_name", activeFoodPlan);
      if (error) throw error;
      setFoodPlans((prev) => prev.filter((p) => p.plan_name !== activeFoodPlan));
      toast.success(isEn ? "Plan cleared" : "方案美食内容已清空");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? (isEn ? "Clear failed" : "清空失败"));
    } finally {
      setClearing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Word Import — 双板块智能解析引擎（特色菜规划 + 精选餐厅，缺一平滑忽略）
  // ---------------------------------------------------------------------------
  const handleFoodWordImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || foodImporting) return;
    const lowerName = file.name.toLowerCase();
    const isDocx = lowerName.endsWith(".docx");
    const isMd = lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || lowerName.endsWith(".txt");
    if (!isDocx && !isMd) {
      toast.error(isEn ? "Please upload a .docx or .md file" : "请上传 .docx 或 .md 文件");
      return;
    }
    setFoodImporting(true);
    try {
      // 1. 提取纯文本：.docx 用 mammoth，.md/.txt 智能解码（BOM/GBK 兼容）
      const text = await extractDiningText(file);

      // 2. 双板块解析：特色菜 → trip_food_plans，餐厅 → trip_restaurants
      //    空状态（无方案）下导入时回退到默认方案名，确保导入后胶囊与卡片立即可见
      const effectivePlanName = activeFoodPlan || DEFAULT_FOOD_PLAN;
      const { foodPlans: parsedFoodPlans, restaurants: parsedRestaurants } = parseDiningDocument(
        text,
        { tripId, planName: effectivePlanName },
      );

      if (parsedFoodPlans.length === 0 && parsedRestaurants.length === 0) {
        toast.error(isEn ? "No food plans recognized. Please check document format." : "未识别到符合规范的美食攻略，请检查文档格式！");
        return;
      }

      // 3. 按当前子视图分流写入 — 餐厅视图仅写餐厅，特色菜视图仅写特色菜（互不影响）
      if (diningView === "restaurants") {
        if (parsedRestaurants.length === 0) {
          toast.error(isEn ? "No restaurants recognized. Please check document format." : "未识别到符合规范的餐厅内容，请检查文档格式！");
          return;
        }
        // 3.1 地址自动反算坐标：逐家按【地址 + 城市 + 国家 + 名称】正向地理编码
        //     （顺序请求尊重 Nominatim 限流；未命中的餐厅坐标保持 null，地图不渲染）
        //     文档【坐标】/【经纬度】行已预埋高精坐标的餐厅直接采用，跳过网络地理编码
        toast.loading(isEn ? "Resolving restaurant locations..." : "正在解析餐厅坐标…", { id: "food-geo" });
        try {
          for (const r of parsedRestaurants) {
            if (r.latitude != null && r.longitude != null) continue;
            const geo = await geocodeVenue({
              name: r.name,
              address: r.address ?? "",
              cityKey: r.city ?? "",
              countryKey: r.country ?? "",
            });
            if (geo) {
              r.latitude = geo.lat;
              r.longitude = geo.lng;
            }
          }
        } finally {
          toast.dismiss("food-geo");
        }
        const { error } = await db.from("trip_restaurants").insert(parsedRestaurants);
        if (error) throw error;
        toast.success(
          isEn
            ? `Successfully imported ${parsedRestaurants.length} restaurants!`
            : `成功导入了 ${parsedRestaurants.length} 家餐厅！`,
        );
        setRestaurantsVersion((v) => v + 1);
      } else {
        if (parsedFoodPlans.length === 0) {
          toast.error(isEn ? "No dishes recognized. Please check document format." : "未识别到符合规范的特色菜内容，请检查文档格式！");
          return;
        }
        const { error } = await db.from("trip_food_plans").insert(parsedFoodPlans);
        if (error) throw error;
        toast.success(
          isEn
            ? `Successfully imported ${parsedFoodPlans.length} food items!`
            : `成功导入了 ${parsedFoodPlans.length} 个特色美食！`,
        );
        fetchFoodData();
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? (isEn ? "Import failed" : "导入失败"));
    } finally {
      setFoodImporting(false);
      if (foodFileRef.current) foodFileRef.current.value = "";
    }
  };

  // ---------------------------------------------------------------------------
  // Fetch data (pure load — no static data seeding)
  // ---------------------------------------------------------------------------
  const fetchFoodData = async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const { data: plansData, error: plansErr } = await db
        .from("trip_food_plans")
        .select("id, trip_id, plan_name, plan_date, day_title, course_type, dish_name, description, sequence")
        .eq("trip_id", tripId)
        .order("sequence", { ascending: true })
        .limit(100);

      if (!plansErr && plansData) {
        setFoodPlans(plansData as FoodPlan[]);
        // 纯净提取 DB 中实际存在的方案名，不硬编码注入
        const names = Array.from(
          new Set((plansData as any[]).map((p) => p.plan_name).filter(Boolean)),
        ) as string[];
        setGastronomyPlans(names);

        // 自动激活：有方案但当前为空或不在列表内，切换到第一个
        // 使用函数式更新避免闭包捕获过期的 activeFoodPlan
        if (names.length > 0) {
          setActiveFoodPlan((current) => {
            if (!current || !names.includes(current)) {
              return names[0];
            }
            return current;
          });
        } else {
          setActiveFoodPlan("");
        }
      } else {
        setFoodPlans([]);
        setGastronomyPlans([]);
        setActiveFoodPlan("");
      }

      const { data: guideData } = await db
        .from("trip_food_guides")
        .select("content")
        .eq("trip_id", tripId)
        .maybeSingle();

      setFoodGuide(guideData ? (guideData as any).content || "" : "");
    } catch (err) {
      console.error("Error fetching gastronomy data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFoodData();
  }, [tripId]);

  // ---------------------------------------------------------------------------
  // Main form: add new food plan
  // ---------------------------------------------------------------------------
  const handleAddMainFood = async () => {
    if (!newFoodName.trim()) return;
    setAddingMainFood(true);
    try {
      const nextSeq = foodPlans.length > 0 ? Math.max(...foodPlans.map((p) => p.sequence)) + 1 : 0;
      const { data, error } = await db
        .from("trip_food_plans")
        .insert({
          trip_id: tripId,
          plan_name: activeFoodPlan,
          plan_date: newFoodDate || null,
          course_type: newFoodCourse,
          dish_name: newFoodName.trim(),
          description: newFoodDesc.trim() || null,
          day_title: null,
          sequence: nextSeq,
        })
        .select("id, trip_id, plan_name, plan_date, day_title, course_type, dish_name, description, sequence")
        .single();

      if (error) throw error;
      setFoodPlans((prev) => [...prev, data as FoodPlan]);
      setNewFoodDate("");
      setNewFoodName("");
      setNewFoodDesc("");
      setNewFoodCourse("Starter");
      setIsFoodFormOpen(false);
      toast.success(isEn ? "Added to gastronomy successfully" : "美食计划添加成功");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? (isEn ? "Add failed" : "添加失败"));
    } finally {
      setAddingMainFood(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Grouping algorithm
  // ---------------------------------------------------------------------------
  const getGroupedFoodPlans = () => {
    const grouped: { [key: string]: FoodPlan[] } = {};
    foodPlans
      .filter((plan) => plan.plan_name === activeFoodPlan)
      .forEach((plan) => {
        const dateKey = plan.plan_date || "TBD";
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(plan);
      });

    const sortedDateKeys = Object.keys(grouped).sort((a, b) => {
      if (a === "TBD") return 1;
      if (b === "TBD") return -1;
      return new Date(a).getTime() - new Date(b).getTime();
    });

    return sortedDateKeys.map((dateKey, index) => {
      const items = grouped[dateKey];
      const groupDayTitle = items.find((item) => item.day_title)?.day_title || "";

      const courseOrder: Record<string, number> = { Starter: 1, Main: 2, Snack: 3, Dessert: 4 };
      items.sort((a, b) => (courseOrder[a.course_type || ""] || 9) - (courseOrder[b.course_type || ""] || 9));

      return {
        dateKey,
        dayNumber: index + 1,
        groupDayTitle,
        items,
      };
    });
  };

  // ---------------------------------------------------------------------------
  // Add sub-food
  // ---------------------------------------------------------------------------
  const handleAddSubFood = async () => {
    if (!subFoodTarget || !subFoodName.trim()) return;
    setAddingFood(true);
    try {
      // 优先使用弹窗中用户选择的日期，无则回退到母分项日期
      const effectiveDate = subFoodDate && subFoodDate !== "TBD"
        ? subFoodDate
        : (subFoodTarget.date !== "TBD" ? subFoodTarget.date : "");
      const nextSeq = foodPlans.length > 0 ? Math.max(...foodPlans.map((p) => p.sequence)) + 1 : 0;
      const { data, error } = await db
        .from("trip_food_plans")
        .insert({
          trip_id: tripId,
          plan_name: activeFoodPlan,
          plan_date: effectiveDate || null,
          day_title: subFoodTarget.dayTitle || null,
          course_type: subFoodCourse,
          dish_name: subFoodName.trim(),
          description: subFoodDesc.trim() || null,
          sequence: nextSeq,
        })
        .select("id, trip_id, plan_name, plan_date, day_title, course_type, dish_name, description, sequence")
        .single();

      if (error) throw error;
      setFoodPlans((prev) => [...prev, data as FoodPlan]);
      setSubFoodName("");
      setSubFoodDesc("");
      setSubFoodDate("");
      setSubFoodTarget(null);
      toast.success(isEn ? "Food item added" : "美食添加成功");
    } catch (err: any) {
      console.error("添加美食失败:", err);
      toast.error(err?.message ?? (isEn ? "Failed to add" : "添加失败"));
    } finally {
      setAddingFood(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit food
  // ---------------------------------------------------------------------------
  const handleStartEditFood = (plan: FoodPlan) => {
    setEditingFoodPlan(plan);
    setEditFoodName(plan.dish_name || "");
    setEditFoodDesc(plan.description || "");
    setEditFoodCourse(plan.course_type || "Starter");
    setEditFoodDate(plan.plan_date || "");
    setFoodEditCalendarMode("day");
    setFoodEditCalendarViewDate(plan.plan_date ? new Date(plan.plan_date + "T00:00:00") : new Date());
  };

  const handleUpdateFoodPlan = async () => {
    if (!editingFoodPlan) return;
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!editingFoodPlan.id) return;
    setUpdatingFood(true);
    try {
      const { error } = await db
        .from("trip_food_plans")
        .update({
          course_type: editFoodCourse,
          dish_name: editFoodName.trim() || null,
          description: editFoodDesc.trim() || null,
          plan_date: editFoodDate || null,
        })
        .eq("id", editingFoodPlan.id);

      if (error) throw error;
      setFoodPlans((prev) =>
        prev.map((p) =>
          p.id === editingFoodPlan.id
            ? { ...p, course_type: editFoodCourse, dish_name: editFoodName.trim() || null, description: editFoodDesc.trim() || null, plan_date: editFoodDate || null }
            : p,
        ),
      );
      setEditingFoodPlan(null);
      toast.success(isEn ? "Updated" : "更新成功");
    } catch (err: any) {
      toast.error(err?.message ?? (isEn ? "Update failed" : "更新失败"));
    } finally {
      setUpdatingFood(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete food
  // ---------------------------------------------------------------------------
  const handleDeleteFood = async (id: string) => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return;
    try {
      const { error } = await db.from("trip_food_plans").delete().eq("id", id);
      if (error) throw error;
      setFoodPlans((prev) => prev.filter((p) => p.id !== id));
      toast.success(isEn ? "Deleted" : "已删除");
    } catch (err: any) {
      toast.error(err?.message ?? (isEn ? "Delete failed" : "删除失败"));
    }
  };

  // ---------------------------------------------------------------------------
  // Update day theme (batch)
  // ---------------------------------------------------------------------------
  const handleUpdateFoodDayTheme = async (planDate: string, newTitle: string) => {
    try {
      const trimmed = newTitle.trim();
      const { error } = await db
        .from("trip_food_plans")
        .update({ day_title: trimmed || null })
        .eq("trip_id", tripId)
        .eq("plan_date", planDate);

      if (error) throw error;
      setFoodPlans((prev) =>
        prev.map((p) => (p.plan_date === planDate ? { ...p, day_title: trimmed || null } : p)),
      );
      setEditingFoodDayTheme(null);
      setInlineFoodThemeEdit(null);
      toast.success(isEn ? "Day theme updated" : "当日主题更新成功");
    } catch (err: any) {
      toast.error(err?.message ?? (isEn ? "Update failed" : "更新失败"));
    }
  };

  const grouped = getGroupedFoodPlans();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* 0. 美食模块单行极简头部：左 Import+Clear，右 特色菜/餐厅切换胶囊（双视图共用） */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-muted p-3">
        {/* 左侧：导入 + 清空 */}
        <div className="flex items-center gap-2">
          {/* 美食 Import 导入按钮 — 任何状态（含空状态）均可用 */}
          <label
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-foreground transition-all hover:border-brand/40 hover:text-brand"
            title={
              diningView === "restaurants"
                ? isEn
                  ? "Import restaurants document"
                  : "导入餐厅文档（仅餐厅数据）"
                : isEn
                  ? `Import Word to [${activeFoodPlan || DEFAULT_FOOD_PLAN}]`
                  : `导入 Word 美食方案至 [${activeFoodPlan || DEFAULT_FOOD_PLAN}]`
            }
          >
            {foodImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{isEn ? "Import" : "导入 Word"}</span>
            <input
              ref={foodFileRef}
              type="file"
              accept=".docx,.md,.markdown,.txt"
              className="hidden"
              onChange={handleFoodWordImport}
              disabled={foodImporting}
            />
          </label>

          {/* 清空按钮 — 作用域跟随当前子视图 */}
          <button
            type="button"
            onClick={triggerClearConfirmFood}
            disabled={clearing || (diningView !== "restaurants" && !activeFoodPlan)}
            className="flex items-center justify-center rounded-full border border-border/50 bg-card/80 p-2 text-muted-foreground transition-all hover:text-brand hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-30"
            title={diningView === "restaurants" ? (isEn ? "Clear All Restaurants" : "清空所有餐厅") : isEn ? "Clear All Dishes" : "清空所有特色菜"}
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
          </button>
        </div>

        {/* 右侧：双视图切换胶囊 特色菜 ↔ 餐厅 */}
        <div className="ml-auto flex shrink-0 items-center rounded-full border border-border bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setDiningView("specialties")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
              diningView === "specialties"
                ? "bg-brand text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.3)]"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={isEn ? "Specialties (by day)" : "特色菜（按天排布）"}
          >
            <UtensilsCrossed className="h-3 w-3" />
            <span>{isEn ? "Dishes" : "特色菜"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDiningView("restaurants")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
              diningView === "restaurants"
                ? "bg-brand text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.3)]"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={isEn ? "Restaurants" : "餐厅"}
          >
            <Store className="h-3 w-3" />
            <span>{isEn ? "Restaurants" : "餐厅"}</span>
          </button>
        </div>
      </div>

      {/* ==================== 特色菜视图（按天排布） / 餐厅视图 双视图切换 ==================== */}
      {diningView === "specialties" ? (
      <>
      {/* 1. 顶部点餐指南横幅 */}
      {foodGuide && foodGuide.trim() !== "" && (
        <div
          onClick={() => setIsFoodGuideModalOpen(true)}
          className="group flex w-full cursor-pointer items-center border-b border-brand/20 bg-brand/10 py-3 pl-2 pr-4 transition-all duration-200 hover:bg-brand/15"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <UtensilsCrossed className="h-4 w-4 flex-shrink-0 animate-pulse stroke-[2.2] text-brand transition-transform group-hover:scale-105" />
            <p className="truncate text-xs font-medium text-brand/90">
              <span className="mr-1.5 font-bold text-brand">
                {isEn ? "[Dining Guide]" : "[点餐指南]"}
              </span>
              {isEn
                ? "6-person Precision Dining Guide (Click to expand)"
                : "6 人团“精准执行”点餐指南（点击查看完整版）"}
            </p>
          </div>
        </div>
      )}

      {/* 2. 全局添加美食按钮 — 仅当美食列表为空时显示 */}
      {grouped.length === 0 && activeFoodPlan && (
        <button
          type="button"
          onClick={() => setIsFoodFormOpen(true)}
          disabled={!activeFoodPlan}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 py-2.5 text-xs font-semibold text-foreground transition-all duration-200 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
        >
          <span>{isEn ? "Add Gastronomy" : "添加美食计划"}</span>
        </button>
      )}

      {/* 3. 展开后的新增美食双行玻璃拟态卡片 */}
      {isFoodFormOpen && (
        <div className="flex animate-[fadeIn_0.2s_ease-out_forwards] flex-col gap-3 rounded-xl border border-border bg-muted/50 p-4">
          {/* 第一行：日历 + 菜品分类药丸 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* 自定义日历选择器（带 backdrop 遮罩） */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsMainFoodCalendarOpen(!isMainFoodCalendarOpen)}
                className="flex h-[34px] w-full items-center justify-between rounded-lg border border-border bg-card px-3 text-left text-xs text-foreground transition-all hover:border-brand/40"
              >
                <span>
                  {newFoodDate
                    ? isEn
                      ? `${MONTHS_EN[new Date(newFoodDate + "T00:00:00").getMonth()]} ${new Date(newFoodDate + "T00:00:00").getDate()}, ${new Date(newFoodDate + "T00:00:00").getFullYear()}`
                      : `${new Date(newFoodDate + "T00:00:00").getFullYear()}年${new Date(newFoodDate + "T00:00:00").getMonth() + 1}月${new Date(newFoodDate + "T00:00:00").getDate()}日`
                    : isEn
                      ? "Select Date"
                      : "选择日期"}
                </span>
                <CalendarDays className="h-3.5 w-3.5 text-brand" />
              </button>

              {isMainFoodCalendarOpen && (
                <>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMainFoodCalendarOpen(false);
                    }}
                    className="fixed inset-0 z-40 bg-black/60"
                  />
                  <UnifiedCalendarGrid
                    mode={mainFoodCalendarMode}
                    viewDate={mainFoodCalendarViewDate}
                    selectedDateStr={newFoodDate}
                    setMode={setMainFoodCalendarMode}
                    setViewDate={setMainFoodCalendarViewDate}
                    onSelectDate={(dateStr) => {
                      setNewFoodDate(dateStr);
                      setIsMainFoodCalendarOpen(false);
                    }}
                    labelText={isEn ? "SELECT DATE" : "选择日期"}
                    isEn={isEn}
                    zIndexClass="z-50"
                  />
                </>
              )}
            </div>

            {/* 菜品分类互斥药丸 */}
            <div className="flex h-[34px] items-center gap-1 rounded-lg border border-border bg-card p-1">
              {FOOD_COURSES.map((course) => {
                const isSelected = newFoodCourse === course.key;
                return (
                  <button
                    key={course.key}
                    type="button"
                    onClick={() => setNewFoodCourse(course.key)}
                    className={cn(
                      "flex h-[26px] flex-1 items-center justify-center rounded text-[11px] font-medium transition-all",
                      isSelected
                        ? "bg-brand font-bold text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.3)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {isEn ? course.en : course.zh}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 第二行：菜品名称 + 描述 + 添加按钮 */}
          <div className="grid grid-cols-1 gap-3 border-t border-border pt-2 md:grid-cols-3">
            <input
              value={newFoodName}
              onChange={(e) => setNewFoodName(e.target.value)}
              placeholder={isEn ? "Dish Name (e.g., T-Bone Steak)" : "特色菜名称 (如 3kg T骨牛排)"}
              maxLength={255}
              className="h-[34px] rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand/50"
            />
            <div className="flex h-[34px] gap-2 md:col-span-2">
              <input
                value={newFoodDesc}
                onChange={(e) => setNewFoodDesc(e.target.value)}
                placeholder={isEn ? "Dish Description / Notes..." : "特色描述/特色点缀..."}
                maxLength={2000}
                className="flex-1 rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand/50"
              />
              <button
                type="button"
                onClick={handleAddMainFood}
                disabled={!newFoodName.trim() || addingMainFood}
                className="flex items-center justify-center whitespace-nowrap rounded-lg bg-brand px-5 text-xs font-semibold text-brand-foreground transition-all hover:shadow-[0_0_12px_rgba(0,242,254,0.4)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {addingMainFood ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    {isEn ? "Add Food" : "添加美食"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. 美食时间轴列表（按天聚合） */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="py-8" />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.dateKey} className="space-y-3">
              {/* Day 头部 — 单行布局：[数字圆圈] ... [城市名（整卡宽度水平绝对居中）] ... [+ 新增按钮] */}
              <div className="relative flex items-center justify-between">
                {/* 左侧：Day 圆圈，纯数字，w-9 h-9，加粗 */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/15 text-base font-bold text-brand">
                  {group.dayNumber ?? "?"}
                </div>

                {/* 中间：城市名 — 绝对居中（inset-x-0 + justify-center，不受两侧按钮宽度影响），点击进入行内编辑 */}
                <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
                  {inlineFoodThemeEdit?.date === group.dateKey ? (
                    <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                      <input
                        value={inlineFoodThemeEdit.value}
                        onChange={(e) => setInlineFoodThemeEdit({ date: group.dateKey, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdateFoodDayTheme(group.dateKey, inlineFoodThemeEdit.value);
                          if (e.key === "Escape") setInlineFoodThemeEdit(null);
                        }}
                        className="w-36 rounded-full border border-brand/50 bg-card px-3 py-1 text-center text-lg font-bold text-brand focus:outline-none sm:w-44"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateFoodDayTheme(group.dateKey, inlineFoodThemeEdit.value)}
                        className="shrink-0 rounded-full bg-brand/20 p-1 text-brand transition-colors hover:bg-brand/40"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setInlineFoodThemeEdit(null)}
                        className="shrink-0 rounded-full bg-red-500/20 p-1 text-red-400 transition-colors hover:bg-red-500/40"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setInlineFoodThemeEdit({ date: group.dateKey, value: group.groupDayTitle || "" })}
                      className="pointer-events-auto max-w-[70%] whitespace-normal break-words leading-snug px-3 text-center text-lg font-bold text-foreground transition-colors hover:text-brand"
                      title={isEn ? "Click to edit city / theme" : "点击编辑城市 / 主题"}
                    >
                      {group.groupDayTitle || (isEn ? "+ City" : "+ 城市")}
                    </button>
                  )}
                </div>

                {/* 右侧：单日添加按钮 — w-9 h-9 匹配 Day 圆圈尺寸，留足触控空间 */}
                <button
                  type="button"
                  onClick={() => {
                    setSubFoodTarget({ date: group.dateKey, dayTitle: group.groupDayTitle });
                    setSubFoodCourse("Starter");
                    setSubFoodName("");
                    setSubFoodDesc("");
                    // 初始化子弹窗日期为当前 Day 的日期，允许用户跨日期自由调整
                    setSubFoodDate(group.dateKey !== "TBD" ? group.dateKey : "");
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-brand"
                  title={isEn ? "Add food" : "添加美食"}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* 美食列表 — 独立气泡卡片堆叠，无时间线（对齐行程模块） */}
              <div className="flex flex-col gap-3">
                {group.items.map((plan) => {
                  const course: CourseType = (plan.course_type as CourseType) || "Starter";
                  const meta = FOOD_COURSES.find((c) => c.key === course) || FOOD_COURSES[0];
                  const CourseIcon = meta.icon;
                  // 全局联动：所有卡片共用 isAllFoodExpanded 状态
                  const isExpanded = isAllFoodExpanded;
                  return (
                    <div
                      key={plan.id}
                      ref={(el) => {
                        foodCardRefs.current[plan.id] = el;
                      }}
                      className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:border-border"
                    >
                      {/* 顶部餐点标签与菜品名称 — 点击触发全局联动切换 */}
                      <div
                        onClick={() => handleToggleAllFood(plan.id)}
                        className="flex items-center justify-between gap-2 cursor-pointer select-none hover:bg-muted/40 -m-1 p-1 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 餐点标签 — 分类专属配色 */}
                          <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold font-mono ${meta.badgeCls}`}>
                            <CourseIcon className="w-3.5 h-3.5" />
                            {isEn ? meta.en : meta.zh}
                          </span>
                          {/* 菜品名称 */}
                          <h4 className="text-base font-bold text-foreground">
                            {plan.dish_name || (isEn ? "Unnamed" : "未命名")}
                          </h4>
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
                          {plan.description && (
                            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed pr-8">
                              {plan.description}
                            </p>
                          )}
                          {/* 右下角编辑按钮 */}
                          <div className="mt-2 flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation(); // 阻止触发全局联动切换
                                handleStartEditFood(plan);
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
      </>
      ) : (
        <RestaurantsView key={restaurantsVersion} tripId={tripId} />
      )}

      {/* ==================== Modals ==================== */}

      {/* Food Guide Modal — 仅特色菜视图可触发 */}
      {isFoodGuideModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex animate-[fadeIn_0.15s_ease-out_forwards] items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setIsFoodGuideModalOpen(false)}
        >
          <div
            className="relative w-full max-w-md animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                <UtensilsCrossed className="h-4 w-4 text-brand" />
                <span>{isEn ? "Dining Guide" : "点餐指南"}</span>
              </h3>
              <button type="button" onClick={() => setIsFoodGuideModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
              {foodGuide.split("\n").map((line, i) => (
                <p key={i} className={line.trim().startsWith("#") || line.trim().startsWith("【") ? "font-bold text-foreground" : ""}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Sub-Food Modal — 去噪 + 对齐行程模块 */}
      {subFoodTarget && (
        <div
          className="fixed inset-0 z-[60] flex animate-[fadeIn_0.15s_ease-out_forwards] items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setSubFoodTarget(null)}
        >
          <div
            className="relative w-full max-w-sm animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] rounded-2xl border border-border bg-muted p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              {/* DATE 日期选择 — 复用 UnifiedCalendarGrid 暗夜青蓝风格，与行程弹窗 100% 统一 */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground tracking-wider mb-2">
                  {isEn ? "DATE" : "日期"}
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (subFoodDate) setSubFoodCalendarViewDate(new Date(subFoodDate + "T00:00:00"));
                      setSubFoodCalendarMode("day");
                      setIsSubFoodCalendarOpen(!isSubFoodCalendarOpen);
                    }}
                    className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted px-3 text-left text-sm text-foreground transition-all hover:border-brand/40"
                  >
                    <span>
                      {subFoodDate
                        ? isEn
                          ? `${MONTHS_EN[new Date(subFoodDate + "T00:00:00").getMonth()]} ${new Date(subFoodDate + "T00:00:00").getDate()}, ${new Date(subFoodDate + "T00:00:00").getFullYear()}`
                          : `${new Date(subFoodDate + "T00:00:00").getFullYear()}年${new Date(subFoodDate + "T00:00:00").getMonth() + 1}月${new Date(subFoodDate + "T00:00:00").getDate()}日`
                        : isEn
                          ? "Select Date"
                          : "选择日期"}
                    </span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>
                  {isSubFoodCalendarOpen && (
                    <>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSubFoodCalendarOpen(false);
                        }}
                        className="fixed inset-0 z-[65] bg-black/60"
                      />
                      <UnifiedCalendarGrid
                        mode={subFoodCalendarMode}
                        viewDate={subFoodCalendarViewDate}
                        selectedDateStr={subFoodDate}
                        setMode={setSubFoodCalendarMode}
                        setViewDate={setSubFoodCalendarViewDate}
                        onSelectDate={(dateStr) => {
                          setSubFoodDate(dateStr);
                          setIsSubFoodCalendarOpen(false);
                        }}
                        labelText={isEn ? "SELECT DATE" : "选择日期"}
                        isEn={isEn}
                        zIndexClass="z-[70]"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Course type selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Course Type" : "菜品分类"}
                </label>
                <div className="flex items-center gap-2">
                  {FOOD_COURSES.map((course) => {
                    const CourseIcon = course.icon;
                    const isSelected = subFoodCourse === course.key;
                    return (
                      <button
                        key={course.key}
                        type="button"
                        onClick={() => setSubFoodCourse(course.key)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                          isSelected
                            ? "bg-brand text-brand-foreground"
                            : "bg-brand/15 text-brand hover:bg-brand/20",
                        )}
                      >
                        <CourseIcon className="w-3 h-3" />
                        {isEn ? course.en : course.zh}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Dish name */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Dish Name (Required)" : "菜品名称 (必填)"}
                </label>
                <input
                  type="text"
                  value={subFoodName}
                  onChange={(e) => setSubFoodName(e.target.value)}
                  placeholder={isEn ? "e.g., Tagliatelle al Ragù" : "如：米兰炖牛膝"}
                  maxLength={255}
                  className="h-9 w-full rounded-xl border border-border/50 bg-card/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>
              {/* Description */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Description" : "描述信息"}
                </label>
                <textarea
                  value={subFoodDesc}
                  onChange={(e) => setSubFoodDesc(e.target.value)}
                  rows={3}
                  placeholder={isEn ? "Notes..." : "备注..."}
                  maxLength={2000}
                  className="w-full resize-none rounded-xl border border-border/50 bg-card/80 px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
            {/* 底部操作栏 — 仅纯圆形 + 发光按钮 */}
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setSubFoodTarget(null)}
                className="rounded-full border border-border bg-card px-4 py-2 text-xs text-muted-foreground transition-all hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleAddSubFood}
                disabled={addingFood || !subFoodName.trim()}
                aria-label={isEn ? "Add" : "添加"}
                className="w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center shadow-[0_0_12px_rgba(0,242,254,0.4)] transition-all hover:shadow-[0_0_16px_rgba(0,242,254,0.5)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {addingFood ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Food Modal — 对齐行程模块 */}
      {editingFoodPlan && (
        <div
          className="fixed inset-0 z-[60] flex animate-[fadeIn_0.15s_ease-out_forwards] items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setEditingFoodPlan(null)}
        >
          <div
            className="relative w-full max-w-sm animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] rounded-2xl border border-border bg-muted p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部：标题 + 右侧删除/保存按钮 */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Pencil className="h-4 w-4 text-brand" />
                <span>{isEn ? "Edit Food" : "修改美食"}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFoodDeleteDialogOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-1.5 text-xs text-red-400 transition-all hover:bg-red-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isEn ? "Delete" : "删除"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleUpdateFoodPlan}
                  disabled={updatingFood}
                  title={isEn ? "Save" : "保存"}
                  className="w-10 h-10 rounded-full bg-brand text-brand-foreground flex items-center justify-center shadow-[0_0_10px_rgba(0,242,254,0.4)] hover:scale-105 transition-all disabled:opacity-40"
                >
                  {updatingFood ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-4 mt-4">
              {/* Date picker */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Date" : "日期"}
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsFoodEditCalendarOpen(!isFoodEditCalendarOpen)}
                    className="flex h-9 w-full items-center justify-between rounded-xl border border-border/50 bg-card/80 px-3 text-left text-xs text-foreground transition-all hover:border-brand"
                  >
                    <span>
                      {editFoodDate
                        ? isEn
                          ? `${MONTHS_EN[new Date(editFoodDate + "T00:00:00").getMonth()]} ${new Date(editFoodDate + "T00:00:00").getDate()}, ${new Date(editFoodDate + "T00:00:00").getFullYear()}`
                          : `${new Date(editFoodDate + "T00:00:00").getFullYear()}年${new Date(editFoodDate + "T00:00:00").getMonth() + 1}月${new Date(editFoodDate + "T00:00:00").getDate()}日`
                        : isEn
                          ? "Select Date"
                          : "选择日期"}
                    </span>
                    <CalendarDays className="h-3.5 w-3.5 text-brand" />
                  </button>
                  {isFoodEditCalendarOpen && (
                    <>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsFoodEditCalendarOpen(false);
                        }}
                        className="fixed inset-0 z-[65] bg-black/60"
                      />
                      <UnifiedCalendarGrid
                        mode={foodEditCalendarMode}
                        viewDate={foodEditCalendarViewDate}
                        selectedDateStr={editFoodDate}
                        setMode={setFoodEditCalendarMode}
                        setViewDate={setFoodEditCalendarViewDate}
                        onSelectDate={(dateStr) => {
                          setEditFoodDate(dateStr);
                          setIsFoodEditCalendarOpen(false);
                        }}
                        labelText={isEn ? "EDIT DATE" : "修改日期"}
                        isEn={isEn}
                        zIndexClass="z-[70]"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Course type */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Course Type" : "菜品分类"}
                </label>
                <div className="flex items-center gap-2">
                  {FOOD_COURSES.map((course) => {
                    const CourseIcon = course.icon;
                    const isSelected = editFoodCourse === course.key;
                    return (
                      <button
                        key={course.key}
                        type="button"
                        onClick={() => setEditFoodCourse(course.key)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                          isSelected
                            ? "bg-brand text-brand-foreground"
                            : "bg-brand/15 text-brand hover:bg-brand/20",
                        )}
                      >
                        <CourseIcon className="w-3 h-3" />
                        {isEn ? course.en : course.zh}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Dish Name" : "菜品名称"}
                </label>
                <input
                  type="text"
                  value={editFoodName}
                  onChange={(e) => setEditFoodName(e.target.value)}
                  maxLength={255}
                  className="h-9 w-full rounded-xl border border-border/50 bg-card/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase mb-2">
                  {isEn ? "Description" : "描述信息"}
                </label>
                <textarea
                  value={editFoodDesc}
                  onChange={(e) => setEditFoodDesc(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-none rounded-xl border border-border/50 bg-card/80 px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除美食确认弹窗 — 替代原生 window.confirm（z-[80] 确保浮于编辑弹窗 z-[60] 之上） */}
      <AlertDialog open={foodDeleteDialogOpen} onOpenChange={setFoodDeleteDialogOpen}>
        <AlertDialogContent className="z-[80] max-w-sm rounded-2xl border-border bg-card p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{isEn ? "Delete Item" : "删除菜品"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isEn
                ? "Are you sure you want to delete this food item?"
                : "确定要删除这道特色菜吗？此操作无法撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (editingFoodPlan) {
                  handleDeleteFood(editingFoodPlan.id);
                  setEditingFoodPlan(null);
                }
                setFoodDeleteDialogOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isEn ? "Confirm" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Day Theme Modal */}
      {editingFoodDayTheme && (
        <div
          className="fixed inset-0 z-[60] flex animate-[fadeIn_0.15s_ease-out_forwards] items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setEditingFoodDayTheme(null)}
        >
          <div
            className="relative w-full max-w-sm animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] rounded-2xl border border-border bg-muted p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-foreground">
              <Compass className="h-4 w-4 animate-pulse text-brand" />
              <span>{isEn ? "Edit Day Theme" : "修改当日主题"}</span>
            </h3>
            <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
              {isEn ? `Setting theme for ${editingFoodDayTheme.date}` : `为 [${editingFoodDayTheme.date}] 设定美食主题`}
            </p>
            <input
              type="text"
              value={newFoodDayThemeInput}
              onChange={(e) => setNewFoodDayThemeInput(e.target.value)}
              placeholder={isEn ? "e.g., Canal District feast" : "如：运河区的丰盛首晚"}
              maxLength={255}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/30"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdateFoodDayTheme(editingFoodDayTheme.date, newFoodDayThemeInput);
              }}
            />
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4 text-xs">
              <button
                type="button"
                onClick={() => setEditingFoodDayTheme(null)}
                className="rounded-xl border border-border bg-card px-4 py-2 text-muted-foreground transition-all hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => handleUpdateFoodDayTheme(editingFoodDayTheme.date, newFoodDayThemeInput)}
                className="rounded-xl bg-brand px-5 py-2 font-semibold text-brand-foreground transition-all hover:shadow-[0_0_12px_rgba(0,242,254,0.4)]"
              >
                {isEn ? "Save" : "确认修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 美食清空确认弹窗（作用域隔离特色菜/餐厅） ==================== */}
      {foodConfirmModal.isOpen && (
        <div
          className="fixed inset-0 z-[60] flex animate-[fadeIn_0.15s_ease-out_forwards] items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setFoodConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="relative w-full max-w-sm animate-[scaleUp_0.2s_cubic-bezier(0.34,1.56,0.64,1)_forwards] rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-bold text-foreground">
              {foodConfirmModal.title}
            </h3>
            <p className="mb-6 text-xs leading-relaxed text-muted-foreground">
              {foodConfirmModal.message}
            </p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setFoodConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-foreground transition-all hover:text-foreground"
              >
                {isEn ? "Cancel" : "取消"}
              </button>
              <button
                type="button"
                onClick={handleConfirmFoodSubmit}
                className="rounded-full bg-amber-600 px-4 py-1.5 font-semibold text-white shadow-lg shadow-amber-950/50 transition-all hover:bg-amber-500"
              >
                {isEn ? "Confirm" : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
