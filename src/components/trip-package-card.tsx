import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, PackageOpen, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useT, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
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

/**
 * 旅行数据包（导入与导出）
 * 一键导出/导入本行程的全部规划：物品清单(trip_items)、行程规划(trip_plans)、
 * 美食规划(trip_food_plans)、精选餐厅(trip_restaurants)、博物馆百科(encyclopedia_items)、
 * 酒店(hotels)。
 *
 * - 导出：标准 JSON 数据包（${tripName}_旅行数据包.json），体积极小，0 流量损耗。
 * - 导入：校验 version + data 节点 → 智能识别存在的模块（支持部分导入）→
 *   分模块批量写入（trip_id 重映射 + 新 UUID）→ invalidateQueries 刷新缓存。
 * - 前端提供分模块导入进度条与错误边界（单模块失败不阻断其余模块，部分成功也如实反馈）。
 */

interface PkgItemCheck {
  item_id: string;
  user_id: string;
  is_checked: boolean;
}

interface TripPackage {
  version: string;
  app: string;
  exportedAt: string;
  tripName: string;
  data: {
    items: any[];
    itemChecks: PkgItemCheck[];
    plans: any[];
    foodPlans: any[];
    restaurants: any[];
    encyclopedia: any[];
    hotels: any[];
  };
}

interface PendingPackage {
  tripName: string;
  exportedAt: string;
  items: any[];
  plans: any[];
  foodPlans: any[];
  restaurants: any[];
  encyclopedia: any[];
  hotels: any[];
}

/** 导入进度：当前模块名 + 已完成模块数 / 总模块数 */
interface ImportProgress {
  label: string;
  done: number;
  total: number;
}

// 生成新 UUID（优先原生 crypto.randomUUID，老浏览器降级）
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 坐标安全解析：JSON 中的经纬度可能是 number 或数字型字符串（手工编辑的数据包），
 * 两者均完整保留写入新行程，绝不能丢弃坐标；非法值返回 null。
 */
function num(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function TripPackageCard({ tripId, tripName }: { tripId: string; tripName: string }) {
  const t = useT();
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [pending, setPending] = useState<PendingPackage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------------
  // 打包导出：拉取 4 大模块全量数据 → 标准数据包 JSON 下载
  // 文件名：${tripName}_旅行数据包.json（纯文本 JSON，体积极小，0 流量损耗）
  // ------------------------------------------------------------------
  async function handleExport() {
    setExporting(true);
    try {
      const db = supabase as any;

      // 1. 物品清单（含全组成员勾选状态，实现"完成状态"无损备份）
      const { data: items, error: itemsErr } = await db
        .from("trip_items")
        .select("id, trip_id, name, created_by, city, latitude, longitude, created_at")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (itemsErr) throw itemsErr;
      const itemList = items ?? [];

      let itemChecks: PkgItemCheck[] = [];
      if (itemList.length > 0) {
        const { data: checks, error: checksErr } = await db
          .from("user_item_checks")
          .select("item_id, user_id, is_checked")
          .in(
            "item_id",
            itemList.map((i: any) => i.id),
          );
        if (checksErr) throw checksErr;
        itemChecks = (checks ?? []).filter((c: PkgItemCheck) => c.is_checked);
      }

      // 2. 行程规划
      const { data: plans, error: plansErr } = await db
        .from("trip_plans")
        .select("id, trip_id, time_label, location, activity, sequence, plan_date, plan_time, day_title, plan_name")
        .eq("trip_id", tripId)
        .order("sequence", { ascending: true })
        .limit(500);
      if (plansErr) throw plansErr;

      // 3. 美食规划
      const { data: foodPlans, error: foodErr } = await db
        .from("trip_food_plans")
        .select("id, trip_id, plan_name, plan_date, day_title, course_type, dish_name, description, sequence")
        .eq("trip_id", tripId)
        .order("sequence", { ascending: true })
        .limit(500);
      if (foodErr) throw foodErr;

      // 4. 精选餐厅（含必点菜品 dishes、攻略截图 attachments 完整 JSON + 定位坐标）
      const { data: restaurants, error: restErr } = await db
        .from("trip_restaurants")
        .select("id, trip_id, name, city, country, meal_type, address, hours, notes, dishes, attachments, latitude, longitude, created_at")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (restErr) throw restErr;

      // 5. 博物馆百科（含核心展品 exhibits、导览图 attachments 等完整 JSON + 定位坐标）
      const { data: encyclopedia, error: encErr } = await db
        .from("encyclopedia_items")
        .select(
          "id, title, subtitle, description, image_url, opening_hours, country_key, city_key, address, location, is_planned, created_at, exhibits, artifacts, attachments, latitude, longitude",
        )
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (encErr) throw encErr;

      // 6. 酒店（含入住周期、坐标、备注、封面）
      const { data: hotels, error: hotelsErr } = await db
        .from("hotels")
        .select("id, name, city, country, address, latitude, longitude, check_in_date, check_out_date, notes, cover_image_url, is_starred, created_at")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (hotelsErr) throw hotelsErr;

      const pkg: TripPackage = {
        version: "1.0",
        app: "TravelTogether",
        exportedAt: new Date().toISOString(),
        tripName,
        data: {
          items: itemList,
          itemChecks,
          plans: plans ?? [],
          foodPlans: foodPlans ?? [],
          restaurants: restaurants ?? [],
          encyclopedia: encyclopedia ?? [],
          hotels: hotels ?? [],
        },
      };

      // 触发浏览器下载：${tripName}_旅行数据包.json
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = tripName.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "trip";
      const suffix = locale === "zh" ? "旅行数据包" : "TripPackage";
      a.href = url;
      a.download = `${safeName}_${suffix}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const total =
        pkg.data.items.length +
        pkg.data.plans.length +
        pkg.data.foodPlans.length +
        pkg.data.restaurants.length +
        pkg.data.encyclopedia.length +
        pkg.data.hotels.length;
      toast.success(t("settings.exportSuccess", { count: total }));
    } catch (err: any) {
      console.error("[TripPackage] export failed:", err);
      toast.error(err?.message || t("settings.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  // ------------------------------------------------------------------
  // 包裹导入：选择 JSON → 校验（version + data）→ 智能识别模块 → 确认 → 批量克隆
  // ------------------------------------------------------------------
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let pkg: any;
      try {
        pkg = JSON.parse(text);
      } catch {
        throw new Error("invalid json");
      }
      // 合法性校验：必须包含 version 与 data 节点
      if (
        !pkg ||
        typeof pkg !== "object" ||
        !pkg.version ||
        !pkg.data ||
        typeof pkg.data !== "object"
      ) {
        throw new Error("invalid package");
      }
      const d = pkg.data;
      // 智能识别各模块数据（缺失的模块按空数组处理，支持部分导入）
      // 注意：itemChecks（历史打勾关联记录）严禁读取 —— 导入后打包进度强制归零
      const parsed: PendingPackage = {
        tripName: pkg.tripName || "",
        exportedAt: pkg.exportedAt || "",
        items: Array.isArray(d.items) ? d.items : [],
        plans: Array.isArray(d.plans) ? d.plans : [],
        foodPlans: Array.isArray(d.foodPlans) ? d.foodPlans : [],
        restaurants: Array.isArray(d.restaurants) ? d.restaurants : [],
        encyclopedia: Array.isArray(d.encyclopedia) ? d.encyclopedia : [],
        hotels: Array.isArray(d.hotels) ? d.hotels : [],
      };
      if (
        parsed.items.length === 0 &&
        parsed.plans.length === 0 &&
        parsed.foodPlans.length === 0 &&
        parsed.restaurants.length === 0 &&
        parsed.encyclopedia.length === 0 &&
        parsed.hotels.length === 0
      ) {
        throw new Error("empty package");
      }
      setPending(parsed);
    } catch {
      toast.error(t("settings.invalidPackage"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // 单个模块的批量写入：trip_id 重映射为当前行程 + 生成新 UUID，避免主键冲突
  async function importModule(
    key: "items" | "plans" | "foodPlans" | "restaurants" | "encyclopedia" | "hotels",
    userId: string,
  ): Promise<void> {
    if (!pending) return;
    const db = supabase as any;

    if (key === "items") {
      // 物品克隆：只保留物品名称与分类/坐标内容，所有条目全新未勾选 ——
      // 严禁导入任何历史打勾关联记录（user_item_checks），打包进度强制初始化为 0/N (0%)
      const rows = pending.items.map((it: any) => ({
        id: uuid(),
        trip_id: tripId,
        name: String(it?.name ?? "").slice(0, 500) || t("settings.importedItemName"),
        created_by: userId,
        city: typeof it?.city === "string" ? it.city : "",
        latitude: num(it?.latitude),
        longitude: num(it?.longitude),
        created_at: it?.created_at || new Date().toISOString(),
      }));
      const { error } = await db.from("trip_items").insert(rows);
      if (error) throw error;
      return;
    }

    if (key === "plans") {
      const rows = pending.plans.map((p: any) => ({
        trip_id: tripId,
        plan_name: p?.plan_name ?? null,
        plan_date: p?.plan_date ?? null,
        plan_time: p?.plan_time ?? null,
        day_title: p?.day_title ?? null,
        time_label: p?.time_label ?? null,
        location: p?.location ?? null,
        activity: p?.activity ?? null,
        sequence: typeof p?.sequence === "number" ? p.sequence : 0,
      }));
      const { error } = await db.from("trip_plans").insert(rows);
      if (error) throw error;
      return;
    }

    if (key === "foodPlans") {
      const rows = pending.foodPlans.map((f: any) => ({
        trip_id: tripId,
        plan_name: f?.plan_name ?? null,
        plan_date: f?.plan_date ?? null,
        day_title: f?.day_title ?? null,
        course_type: f?.course_type ?? null,
        dish_name: f?.dish_name ?? null,
        description: f?.description ?? null,
        sequence: typeof f?.sequence === "number" ? f.sequence : 0,
      }));
      const { error } = await db.from("trip_food_plans").insert(rows);
      if (error) throw error;
      return;
    }

    if (key === "restaurants") {
      // 餐厅克隆：新 UUID + trip_id 重映射，dishes / attachments JSONB 完整保留，
      // 定位坐标（latitude / longitude）100% 完整写入，绝不丢弃
      const rows = pending.restaurants.map((r: any) => ({
        id: uuid(),
        trip_id: tripId,
        name: String(r?.name ?? "").slice(0, 500) || t("settings.importedItemName"),
        city: typeof r?.city === "string" ? r.city : null,
        country: typeof r?.country === "string" ? r.country : null,
        meal_type: typeof r?.meal_type === "string" ? r.meal_type : "dinner",
        address: typeof r?.address === "string" ? r.address : null,
        hours: typeof r?.hours === "string" ? r.hours : null,
        notes: typeof r?.notes === "string" ? r.notes : null,
        dishes: Array.isArray(r?.dishes) ? r.dishes : [],
        attachments: Array.isArray(r?.attachments) ? r.attachments : [],
        latitude: num(r?.latitude),
        longitude: num(r?.longitude),
      }));
      const { error } = await db.from("trip_restaurants").insert(rows);
      if (error) throw error;
      return;
    }

    if (key === "hotels") {
      // 酒店克隆：新 UUID + trip_id 重映射，坐标/入住周期/备注/封面完整保留
      const rows = pending.hotels.map((h: any) => ({
        id: uuid(),
        trip_id: tripId,
        user_id: userId,
        name: String(h?.name ?? "").slice(0, 500) || t("settings.importedItemName"),
        city: typeof h?.city === "string" ? h.city : "",
        country: typeof h?.country === "string" ? h.country : "",
        address: typeof h?.address === "string" ? h.address : "",
        latitude: num(h?.latitude),
        longitude: num(h?.longitude),
        check_in_date: h?.check_in_date || null,
        check_out_date: h?.check_out_date || null,
        notes: typeof h?.notes === "string" ? h.notes : "",
        cover_image_url: typeof h?.cover_image_url === "string" ? h.cover_image_url : "",
        is_starred: !!h?.is_starred,
      }));
      const { error } = await db.from("hotels").insert(rows);
      if (error) throw error;
      return;
    }

    // encyclopedia —— 完整克隆 exhibits / artifacts / attachments 等 JSONB，
    // 定位坐标（latitude / longitude）100% 完整写入，绝不丢弃（地图金色星标依赖）
    const rows = pending.encyclopedia.map((m: any) => ({
      trip_id: tripId,
      user_id: userId,
      title: String(m?.title ?? "").slice(0, 500) || t("settings.importedItemName"),
      subtitle: m?.subtitle ?? "",
      description: m?.description ?? "",
      country_key: m?.country_key ?? "",
      city_key: m?.city_key ?? "",
      opening_hours: m?.opening_hours ?? "",
      image_url: m?.image_url ?? "",
      is_planned: !!m?.is_planned,
      address: m?.address ?? "",
      location: m?.location ?? "",
      latitude: num(m?.latitude),
      longitude: num(m?.longitude),
      exhibits: Array.isArray(m?.exhibits) ? m.exhibits : [],
      artifacts: Array.isArray(m?.artifacts) ? m.artifacts : [],
      attachments: Array.isArray(m?.attachments) ? m.attachments : [],
    }));
    const { error } = await db.from("encyclopedia_items").insert(rows);
    if (error) throw error;
  }

  async function confirmImport() {
    if (!pending || importing) return;
    setImporting(true);

    // 仅统计数据包中实际存在的模块（智能识别 → 部分导入兼容）
    const modules = (
      [
        { key: "items", label: t("settings.pkgModuleItems"), count: pending.items.length },
        { key: "plans", label: t("settings.pkgModulePlans"), count: pending.plans.length },
        { key: "foodPlans", label: t("settings.pkgModuleFood"), count: pending.foodPlans.length },
        { key: "restaurants", label: t("settings.pkgModuleRestaurants"), count: pending.restaurants.length },
        { key: "encyclopedia", label: t("settings.pkgModuleEncyclopedia"), count: pending.encyclopedia.length },
        { key: "hotels", label: t("settings.pkgModuleHotels"), count: pending.hotels.length },
      ] as const
    ).filter((m) => m.count > 0);

    const total = modules.length;
    setImportProgress({ label: modules[0]?.label ?? "", done: 0, total });

    // 错误边界：逐模块捕获失败，单模块出错不阻断其余模块
    const failed: string[] = [];
    const ok = { items: 0, plans: 0, foodPlans: 0, restaurants: 0, encyclopedia: 0, hotels: 0 };

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(locale === "zh" ? "未登录" : "Not authenticated");

      let done = 0;
      for (const mod of modules) {
        setImportProgress({ label: mod.label, done, total });
        try {
          await importModule(mod.key, user.id);
          ok[mod.key] = mod.count;
        } catch (err: any) {
          console.error(`[TripPackage] import module '${mod.key}' failed:`, err);
          failed.push(mod.label);
        }
        done += 1;
        setImportProgress({ label: mod.label, done, total });
      }

      // 清理博物馆/酒店 localStorage 缓存，确保规划页重新拉取最新数据
      try {
        localStorage.removeItem(`encyclopedia:museums:${tripId}`);
        localStorage.removeItem(`hotels:list:${tripId}`);
      } catch {
        /* non-fatal */
      }

      // 状态刷新：invalidateQueries 清空规划模块 / 信息模块等全部 react-query 缓存
      await queryClient.invalidateQueries();

      const sep = locale === "zh" ? "、" : ", ";
      const okParts: string[] = [];
      if (ok.items > 0) okParts.push(t("settings.pkgSumItems", { n: ok.items }));
      if (ok.plans > 0) okParts.push(t("settings.pkgSumPlans", { n: ok.plans }));
      if (ok.foodPlans > 0) okParts.push(t("settings.pkgSumFood", { n: ok.foodPlans }));
      if (ok.restaurants > 0) okParts.push(t("settings.pkgSumRestaurants", { n: ok.restaurants }));
      if (ok.encyclopedia > 0) okParts.push(t("settings.pkgSumEncyclopedia", { n: ok.encyclopedia }));
      if (ok.hotels > 0) okParts.push(t("settings.pkgSumHotels", { n: ok.hotels }));
      const okSummary = okParts.join(sep);

      if (failed.length === 0) {
        toast.success(
          t("settings.importSuccess", {
            items: ok.items,
            plans: ok.plans,
            foodPlans: ok.foodPlans,
            restaurants: ok.restaurants,
            encyclopedia: ok.encyclopedia,
            hotels: ok.hotels,
          }),
        );
      } else if (okParts.length > 0) {
        toast.warning(
          t("settings.importPartial", { failed: failed.join(sep), summary: okSummary }),
        );
      } else {
        toast.error(t("settings.importAllFailed", { failed: failed.join(sep) }));
      }
      setPending(null);
    } catch (err: any) {
      console.error("[TripPackage] import failed:", err);
      toast.error(err?.message || t("settings.importFailed"));
      setPending(null);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  // 确认弹窗摘要：仅列出数据包中实际存在的模块（如只有清单和百科也能正确展示）
  function buildSummary(p: PendingPackage | null): string {
    if (!p) return "";
    const sep = locale === "zh" ? "、" : ", ";
    const parts: string[] = [];
    if (p.items.length) parts.push(t("settings.pkgSumItems", { n: p.items.length }));
    if (p.plans.length) parts.push(t("settings.pkgSumPlans", { n: p.plans.length }));
    if (p.foodPlans.length) parts.push(t("settings.pkgSumFood", { n: p.foodPlans.length }));
    if (p.restaurants.length) parts.push(t("settings.pkgSumRestaurants", { n: p.restaurants.length }));
    if (p.encyclopedia.length) parts.push(t("settings.pkgSumEncyclopedia", { n: p.encyclopedia.length }));
    if (p.hotels.length) parts.push(t("settings.pkgSumHotels", { n: p.hotels.length }));
    return parts.join(sep);
  }

  const busy = exporting || importing;
  const pct =
    importProgress && importProgress.total > 0
      ? Math.round((importProgress.done / importProgress.total) * 100)
      : 0;

  return (
    <section
      className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <PackageOpen className="h-4 w-4 text-brand" />
        {t("settings.tripPackage")}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("settings.tripPackageDesc")}</p>

      <div className="grid grid-cols-2 gap-2">
        {/* 打包导出 — 次要按钮 */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={busy}
          className="font-medium"
        >
          {exporting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          {t("settings.exportPackage")}
        </Button>

        {/* 包裹导入 — 品牌青绿主色 */}
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="bg-brand font-medium text-brand-foreground shadow-[0_0_15px_rgba(13,148,136,0.3)] hover:bg-brand/90"
        >
          {importing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          {t("settings.importPackage")}
        </Button>
      </div>

      <input
        type="file"
        accept="application/json,.json"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 导入确认弹窗：数据包摘要 + 分模块导入进度 */}
      <AlertDialog open={!!pending} onOpenChange={(open) => !open && !importing && setPending(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.importConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {importing ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      {t("settings.importProgress", {
                        module: importProgress?.label ?? "",
                        done: importProgress?.done ?? 0,
                        total: importProgress?.total ?? 0,
                      })}
                    </p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p>
                      {t("settings.importConfirmDesc", {
                        name: tripName,
                        summary: buildSummary(pending),
                      })}
                    </p>
                    {pending?.tripName && pending.tripName !== tripName && (
                      <p className="text-xs">{t("settings.importSource", { name: pending.tripName })}</p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmImport();
              }}
              disabled={importing}
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {importing ? t("settings.importing") : t("settings.importConfirmBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
