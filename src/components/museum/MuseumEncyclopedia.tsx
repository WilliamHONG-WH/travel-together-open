import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Bookmark, MapPin, Building2, Plus, ChevronDown, Eraser } from "lucide-react";
import { toast } from "sonner";
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
import { supabase } from "@/integrations/supabase/client";
import type { Museum } from "./museumData";
import { MuseumDetail } from "./MuseumDetail";
import { MuseumCard } from "./MuseumCard";
import { LocationFilterModal } from "@/components/location-filter-modal";
import { useT, useI18n } from "@/i18n";
import {
  getLocalizedCountry,
  getLocalizedCity,
  resolveCountryKey,
  resolveCityKey,
} from "@/constants/locations";
import { geocodeVenue } from "@/lib/geocode";

const STORAGE_KEY = "encyclopedia:museums";

/**
 * 旧数据兼容：将历史版本中可能存在的 `country` / `city` 名称字符串字段
 * 迁移为标准化 `countryKey` / `cityKey`。仅做一次性补齐，无旧字段时直接返回。
 */
function migrateLegacyMuseum(raw: any): Museum {
  if (raw && typeof raw === "object") {
    if (!raw.countryKey && raw.country) {
      const resolved = resolveCountryKey(raw.country);
      if (resolved) raw.countryKey = resolved;
    }
    if (!raw.cityKey && raw.city) {
      const resolved = resolveCityKey(raw.city, raw.countryKey || raw.country);
      if (resolved) raw.cityKey = resolved;
    }
    delete raw.country;
    delete raw.city;
  }
  return raw as Museum;
}

function loadFromLocal(tripId: string): Museum[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${tripId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(migrateLegacyMuseum) as Museum[];
  } catch {
    return null;
  }
}

function saveToLocal(tripId: string, list: Museum[]) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${tripId}`, JSON.stringify(list));
  } catch (err) {
    console.warn("localStorage save failed:", err);
  }
}

/** Supabase 行 → Museum 对象映射
 *  严格对齐 encyclopedia_items 真实 Schema 全量字段：
 *  id, created_at, updated_at, trip_id, user_id, title, subtitle, description,
 *  image_url, country_key, city_key, address, location, opening_hours,
 *  is_planned, status, exhibits, artifacts, attachments, latitude, longitude
 */
export function mapRowToMuseum(row: any): Museum {
  const intro = row.description ?? "";
  return {
    id: row.id,
    name: row.title || "",
    nameCn: row.subtitle ?? undefined,
    cover: row.image_url || "",
    address: row.address || "",
    location: row.location || "",
    hours: row.opening_hours ?? "",
    snippet: intro ? String(intro).slice(0, 80) : "",
    intro,
    exhibits: Array.isArray(row.exhibits) ? row.exhibits : [],
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
    countryKey: row.country_key || "",
    cityKey: row.city_key || "",
    planned: !!row.is_planned,
    createdAt: row.created_at || "",
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    latitude: row.latitude != null && isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    longitude: row.longitude != null && isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
  };
}

export function MuseumEncyclopedia({ tripId }: { tripId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  // 初始值：优先读取 localStorage 缓存（按 tripId 隔离），无缓存时为空数组（不 fallback 到硬编码 Mock）
  const [museums, setMuseums] = useState<Museum[]>(() => loadFromLocal(tripId) ?? []);
  const [country, setCountry] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [plannedOnly, setPlannedOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // 新建百科弹窗状态：null = 关闭，"new" = 新建模式
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  // 国家·城市联动筛选弹窗
  const [showLocationFilter, setShowLocationFilter] = useState(false);
  // 一键清空“下一站”确认弹窗
  const [clearPlannedOpen, setClearPlannedOpen] = useState(false);
  const [loading, setLoading] = useState(!loadFromLocal(tripId));

  // museums 最新值的稳定引用：让 togglePlanned 读取当前状态的同时，
  // 保持 useCallback 固定引用（MuseumCard 记忆化生效的前提）
  const museumsRef = useRef(museums);
  museumsRef.current = museums;

  // 带条件拉取：必须传入当前 tripId，强制按行程隔离
  const fetchWikiItems = async (silent = false) => {
    if (!tripId) return;
    // 静默刷新时不展示全屏 Loading，保留缓存数据直接渲染
    if (!silent) setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("encyclopedia_items")
        // 严格对齐真实 Schema 全量字段：id, created_at, updated_at, trip_id, user_id,
        // title, subtitle, description, image_url, country_key, city_key, address,
        // location, opening_hours, is_planned, status, exhibits, artifacts, attachments
        .select("id, title, subtitle, description, image_url, opening_hours, country_key, city_key, address, location, is_planned, created_at, exhibits, artifacts, attachments, latitude, longitude")
        .eq("trip_id", tripId)
        // 默认排序：城市名 A-Z 为主，创建时间降序为次
        // 确保同一城市的百科卡片聚集排列，新条目在同城内排前
        .order("city_key", { ascending: true })
        .order("created_at", { ascending: false })
        // 上限放宽至 100，确保全量百科卡片（20+ 张）不被截断
        .limit(100);

      if (!error && data) {
        const mapped = (data as any[]).map(mapRowToMuseum);
        setMuseums(mapped);
        saveToLocal(tripId, mapped);
      } else if (error) {
        console.warn("Supabase encyclopedia fetch failed, fallback to local:", error);
      }
    } catch (err) {
      console.warn("Encyclopedia fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tripId) {
      // 首次无本地缓存时从 Supabase 拉取；有缓存时先展示，后台静默刷新
      const local = loadFromLocal(tripId);
      if (!local) {
        fetchWikiItems(false);
      } else {
        setMuseums(local);
        setLoading(false);
        // 后台静默刷新保证数据最新 (silent=true 不展示 Loading)
        void fetchWikiItems(true);
      }
    } else {
      setMuseums([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const countries = useMemo(
    () => Array.from(new Set(museums.map((m) => m.countryKey))).filter(Boolean).sort(),
    [museums],
  );
  const cities = useMemo(
    () =>
      Array.from(
        new Set(
          museums
            .filter((m) => country === "all" || m.countryKey === country)
            .map((m) => m.cityKey),
        ),
      ).filter(Boolean).sort(),
    [museums, country],
  );

  // 完整的城市→国家映射 (供 LocationFilterModal 联动使用，不受当前筛选限制)
  const cityCountryPairs = useMemo(
    () =>
      museums
        .filter((m) => m.cityKey && m.countryKey)
        .map((m) => ({ city: m.cityKey, country: m.countryKey })),
    [museums],
  );

  const visible = useMemo(
    () =>
      museums
        .filter((m) => {
          // 国家/城市地点筛选：未选择、为空或为 'all' 时默认放行全部
          const isNoLocationFilter = !country || !city;
          const countryMatch = !country || country === "all" || m.countryKey === country;
          const cityMatch = !city || city === "all" || m.cityKey === city;
          if (!isNoLocationFilter && !(countryMatch && cityMatch)) return false;
          if (plannedOnly && !m.planned) return false;
          return true;
        })
        // 客户端兜底排序：城市名 A-Z 为主，创建时间降序为次
        // 与 Supabase 查询的 .order("city_key", { ascending: true }) 保持一致，
        // 确保本地缓存（localStorage）数据 / 新增未刷新条目也按城市聚集排列
        .slice()
        .sort((a, b) => {
          const cityA = (a.cityKey || "").toLowerCase();
          const cityB = (b.cityKey || "").toLowerCase();
          if (cityA < cityB) return -1;
          if (cityA > cityB) return 1;
          // 同城内：创建时间降序（新在前）
          return (b.createdAt || "").localeCompare(a.createdAt || "");
        }),
    [museums, country, city, plannedOnly],
  );

  const active = openId ? museums.find((m) => m.id === openId) ?? null : null;

  // 当前行程下已标记为“下一站”的卡片数量（驱动橡皮擦按钮的显隐）
  const taggedCount = useMemo(() => museums.filter((m) => m.planned).length, [museums]);

  /** 一键清空当前行程下所有“下一站”标记（批量重置 is_planned = false） */
  const clearAllPlanned = async () => {
    try {
      // 乐观更新：本地全部取消标记
      setMuseums((prev) => {
        const next = prev.map((m) => (m.planned ? { ...m, planned: false } : m));
        saveToLocal(tripId, next);
        return next;
      });

      // 批量重置数据库中当前行程下所有已标记行
      const { error } = await (supabase as any)
        .from("encyclopedia_items")
        .update({ is_planned: false })
        .eq("trip_id", tripId)
        .eq("is_planned", true);
      if (error) throw error;

      toast.success(isEn ? "All Next Stop marks cleared" : "已清空所有“下一站”标记");
      // 刷新数据状态，确保多端一致
      await fetchWikiItems(true);
    } catch (dbErr: any) {
      console.error("Supabase clear planned failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database error" : "数据库异常");
      toast.error(isEn ? `Failed to clear marks: ${reason}` : `清空标记失败: ${reason}`);
      // 失败时以数据库为准重新拉取回滚
      await fetchWikiItems(true);
    }
  };

  // 切换“下一站”标记 —— useCallback 固定引用，配合 MuseumCard 的 React.memo，
  // 点击书签时仅重绘被点击的那一张卡片
  const togglePlanned = useCallback(async (id: string) => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return;
    // 通过 ref 读取最新列表，计算目标卡片的新 planned 值
    const target = museumsRef.current.find((m) => m.id === id);
    if (!target) return;
    const nextPlanned = !target.planned;

    // 乐观更新（0ms 响应）：立即翻转本地缓存并写入 localStorage，
    // 书签图标在第 0 毫秒变色，不等待网络
    setMuseums((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, planned: nextPlanned } : m));
      saveToLocal(tripId, next);
      return next;
    });

    // 同步 planned 状态到 Supabase —— 失败时回滚本地状态并 Toast 报错
    try {
      const { error } = await (supabase as any)
        .from("encyclopedia_items")
        .update({ is_planned: nextPlanned })
        .eq("id", id);
      if (error) throw error;
      // 成功后不再触发全量 refetch：本地缓存已同步更新，
      // 重新拉取会导致整页 Loading + 全量重绘（历史卡顿根源），仅在下次进入页面时静默刷新对齐多端
    } catch (dbErr: any) {
      console.error("Supabase planned sync failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database error" : "数据库异常");
      toast.error(
        isEn
          ? `Failed to update plan status: ${reason}`
          : `更新计划状态失败: ${reason}`,
      );
      // 回滚本地状态
      setMuseums((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, planned: !nextPlanned } : m));
        saveToLocal(tripId, next);
        return next;
      });
    }
  }, [tripId, isEn]);

  // 打开详情 — 固定引用供 MuseumCard 记忆化使用
  const openMuseum = useCallback((id: string) => setOpenId(id), []);

  const saveMuseum = async (updated: Museum) => {
    // 判断是新建还是更新：若 museums 中不存在该 id 则为新建
    const isNew = !museums.some((m) => m.id === updated.id);
    // 安全校验：更新模式下 id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!isNew && !updated.id) return;

    // 防御：确保 name/title 字段有值，避免空标题写入数据库后"丢失"；
    // 新建路径若 id 异常缺失则现场补一个合法 UUID，杜绝 insert(undefined)
    const safeName = updated.name?.trim() || "";
    const safeMuseum: Museum = {
      ...updated,
      id: isNew && !updated.id ? crypto.randomUUID() : updated.id,
      name: safeName,
    };

    // 同步写入 Supabase encyclopedia_items 表（出错时不再静默降级）
    try {
      // 获取当前登录用户 ID —— 新建场景必须写入 user_id，否则可能被 RLS 策略静默拦截
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // ========== 自动正向地理编码 (Auto Geocoding) ==========
      // 触发条件：名称·地址·城市变化 / 坐标缺失。
      // 文档【坐标】/【经纬度】行预埋的高精坐标（含新建卡片）直接采用，跳过网络地理编码；
      // 依据【场馆名称 + 详细地址 + 城市 + 国家】调用 Nominatim 解析经纬度，
      // 失败时保留旧坐标（不阻塞保存流程），地图模块仅渲染有坐标的场馆。
      const prev = museums.find((m) => m.id === updated.id);
      const geoChanged =
        !!prev &&
        (prev.address !== safeMuseum.address ||
          prev.cityKey !== safeMuseum.cityKey ||
          prev.name !== safeMuseum.name);
      const needGeo =
        geoChanged || safeMuseum.latitude == null || safeMuseum.longitude == null;
      let latitude = safeMuseum.latitude;
      let longitude = safeMuseum.longitude;
      if (needGeo) {
        const geo = await geocodeVenue({
          name: safeMuseum.name,
          // 外文名称（subtitle）：精准定位策略 2 使用，避免中文与外文地址混拼
          foreignName: safeMuseum.nameCn,
          address: safeMuseum.address,
          cityKey: safeMuseum.cityKey,
          countryKey: safeMuseum.countryKey,
        });
        if (geo) {
          latitude = geo.lat;
          longitude = geo.lng;
        }
      }

      // 严格对齐真实 Schema 全量字段：仅发送 DB 中存在的字段
      // id, created_at, updated_at, trip_id, user_id, title, subtitle, description,
      // image_url, country_key, city_key, address, location, opening_hours,
      // is_planned, status, exhibits, artifacts, attachments, latitude, longitude
      // 绝不主动过滤 address/location/exhibits/artifacts/attachments 这些真实字段
      const payload = {
        trip_id: tripId,
        user_id: user.id,
        title: safeName, // 确保 title 字段有值
        subtitle: safeMuseum.nameCn || "",
        description: safeMuseum.intro || "",
        country_key: safeMuseum.countryKey || "",
        city_key: safeMuseum.cityKey || "",
        opening_hours: safeMuseum.hours || "",
        image_url: safeMuseum.cover || "",
        is_planned: !!safeMuseum.planned,
        address: safeMuseum.address || "",
        location: safeMuseum.location || safeMuseum.address || "",
        exhibits: safeMuseum.exhibits || [],
        artifacts: safeMuseum.artifacts || [],
        attachments: safeMuseum.attachments || [],
        latitude: latitude ?? null,
        longitude: longitude ?? null,
      };

      if (isNew) {
        // 新建：使用前端预生成的合法 UUID 显式 insert（图片已全部上传完毕，
        // 数据库写入与 Storage 路径在同一 ID 体系下闭环，不再依赖回读 id）
        const { data, error } = await (supabase as any)
          .from("encyclopedia_items")
          .insert({ ...payload, id: safeMuseum.id })
          .select("id")
          .single();
        // 严格错误拦截：杜绝"假成功"——只有 error 为空才能继续
        if (error) {
          console.error("保存失败:", error);
          throw new Error(error.message);
        }
        if (!data || !data.id) {
          throw new Error(isEn ? "Insert succeeded but no id returned" : "插入成功但未返回 id");
        }

        // 预生成 ID 与数据库记录完全一致，直接添加到本地状态（新项需 concat 而非 map）
        const newMuseum = { ...safeMuseum, latitude, longitude };
        setMuseums((prev) => [newMuseum, ...prev]);
        saveToLocal(tripId, [newMuseum, ...museums]);
        toast.success(isEn ? "Encyclopedia entry created" : "百科卡片已创建");
      } else {
        // 更新：按 id update
        const { error } = await (supabase as any)
          .from("encyclopedia_items")
          .update(payload)
          .eq("id", updated.id);
        // 严格错误拦截：杜绝"假成功"——只有 error 为空才能继续
        if (error) {
          console.error("保存失败:", error);
          throw new Error(error.message);
        }

        // 乐观更新本地状态：立即反映保存后的标题，无需等待 refetch
        setMuseums((prev) =>
          prev.map((m) => (m.id === updated.id ? { ...safeMuseum, latitude, longitude } : m)),
        );
        saveToLocal(tripId, museums.map((m) => (m.id === updated.id ? { ...safeMuseum, latitude, longitude } : m)));
        toast.success(isEn ? "Encyclopedia entry updated" : "百科卡片已更新");
      }

      // 保存成功后强制从 Supabase 重新拉取列表，确保全平台数据实时同步
      await fetchWikiItems(true);
    } catch (dbErr: any) {
      console.error("Supabase encyclopedia sync failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database write error" : "数据库写入异常");
      toast.error(
        isEn
          ? `Failed to save: ${reason}`
          : `百科卡片保存失败: ${reason}`,
      );
      // 保存失败时不写入本地缓存，避免本地与云端数据不一致
      return;
    }

    // 关闭弹窗（仅保存成功后执行）
    setOpenId(null);
    setIsNewModalOpen(false);
  };

  /** 删除百科卡片：从 Supabase 删除后强制 refetch，返回是否成功 */
  const deleteMuseum = async (id: string): Promise<boolean> => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return false;
    try {
      const { error } = await (supabase as any)
        .from("encyclopedia_items")
        .delete()
        .eq("id", id);
      if (error) throw error;

      // 乐观移除本地状态
      setMuseums((prev) => {
        const next = prev.filter((m) => m.id !== id);
        saveToLocal(tripId, next);
        return next;
      });

      toast.success(isEn ? "Encyclopedia entry deleted" : "百科卡片已删除");

      // 强制从 Supabase 重新拉取，确保全平台同步
      await fetchWikiItems();
      return true;
    } catch (dbErr: any) {
      console.error("Supabase encyclopedia delete failed:", dbErr);
      const reason = dbErr?.message || (isEn ? "Database delete error" : "数据库删除异常");
      toast.error(
        isEn
          ? `Failed to delete: ${reason}`
          : `删除失败: ${reason}`,
      );
      return false;
    }
  };

  const activeFilters =
    (country && country !== "all" ? 1 : 0) +
    (city && city !== "all" ? 1 : 0) +
    (plannedOnly ? 1 : 0);

  // 新建模式使用的空 Museum 草稿 — 使用 useMemo 避免每次渲染创建新对象
  // 导致 MuseumDetail 的 useEffect([museum]) 反复触发
  // 主键改为前端预生成的合法 UUID（每次打开新建弹窗时重新生成），
  // 与编辑模式共用同一套 ID/Storage/写入链路，杜绝 temp-xxx 临时 ID
  const [newMuseumId, setNewMuseumId] = useState(() => crypto.randomUUID());
  const newMuseumDraft = useMemo<Museum>(
    () => ({
      id: newMuseumId,
      name: "",
      nameCn: "",
      countryKey: "",
      cityKey: "",
      address: "",
      location: "",
      hours: "",
      cover: "",
      snippet: "",
      intro: "",
      exhibits: [],
      artifacts: [],
      attachments: [],
      planned: false,
    }),
    [newMuseumId],
  );

  return (
    <div className="mt-4">
      {/* 顶部筛选与新建工具栏 — 全模块统一 h-11 固定高度，消除 Tab 切换抖动 */}
      <div className="flex items-center justify-between gap-2 h-11 my-3 px-1">
        {/* 左侧：国家·城市合并下拉按钮 + 下一站胶囊 */}
        <div className="flex items-center gap-2">
          {/* 国家 · 城市 合并下拉触发按钮 */}
          <button
            onClick={() => setShowLocationFilter(true)}
            className={`h-8 px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 shrink-0 transition-all ${
              activeFilters > 0
                ? "bg-brand/10 text-brand border-brand/30"
                : "bg-muted/90 text-foreground border-border/80 hover:bg-muted"
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>
              {city && city !== "all"
                ? getLocalizedCity(city, locale, country === "all" || !country ? undefined : country)
                : country && country !== "all"
                  ? getLocalizedCountry(country, locale)
                  : isEn ? "Country · City" : "国家 · 城市"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          {/* 下一站胶囊 (精简：只显示“下一站”) */}
          <button
            onClick={() => setPlannedOnly((p) => !p)}
            className={`h-8 px-3.5 rounded-full text-xs font-medium border flex items-center gap-1.5 shrink-0 transition-all ${
              plannedOnly
                ? "bg-brand/10 text-brand border-brand/30"
                : "bg-muted text-muted-foreground border-border/80"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>{isEn ? "Next Stop" : "下一站"}</span>
          </button>

          {/* 一键清空“下一站”橡皮擦按钮 — 仅在 Next Stop 筛选激活且存在已标记卡片时显示 */}
          {plannedOnly && taggedCount > 0 && (
            <button
              onClick={() => setClearPlannedOpen(true)}
              aria-label={isEn ? "Clear all Next Stop marks" : "一键清空下一站标记"}
              title={isEn ? "Clear all Next Stop marks" : "一键清空下一站标记"}
              className="w-8 h-8 rounded-full border border-slate-700/60 bg-slate-800/80 text-slate-400 hover:text-rose-400 hover:border-rose-500/50 flex items-center justify-center transition-all active:scale-95 shadow-sm shrink-0"
            >
              <Eraser className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 右侧：新建圆形按键 — 全模块统一 w-10 h-10 shrink-0
            每次打开都预生成全新 UUID 作为卡片主键，确保新建与编辑共用同一套
            合法 Storage 路径与数据库写入链路（消除 temp-xxx 临时 ID） */}
        <button
          onClick={() => {
            setNewMuseumId(crypto.randomUUID());
            setIsNewModalOpen(true);
          }}
          aria-label={isEn ? "New Encyclopedia" : "新建百科"}
          title={isEn ? "New Encyclopedia" : "新建百科"}
          className="w-10 h-10 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-transform active:scale-95 shrink-0"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      {/* 国家·城市联动筛选弹窗 */}
      <LocationFilterModal
        isOpen={showLocationFilter}
        onClose={() => setShowLocationFilter(false)}
        countries={countries}
        cityCountryPairs={cityCountryPairs}
        selectedCountry={country}
        selectedCity={city}
        onSelect={(nextCountry, nextCity) => {
          setCountry(nextCountry);
          setCity(nextCity);
        }}
        formatCountry={(c) => getLocalizedCountry(c, locale)}
        formatCity={(c) => getLocalizedCity(c, locale, country === "all" || !country ? undefined : country)}
        isEn={isEn}
      />

      {/* Loading 状态 */}
      {loading && (
        <div className="mt-12 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
        </div>
      )}

      {/* Grid — 3 列微型网格布局（卡片为 React.memo 记忆化组件，
          点击书签仅重绘单张卡片，其余卡片跳过渲染） */}
      {!loading && visible.length > 0 && (
        <section className="grid grid-cols-3 gap-2.5 w-full my-3 px-1.5">
          {visible.map((m) => (
            <MuseumCard
              key={m.id}
              museum={m}
              locale={locale}
              onOpen={openMuseum}
              onTogglePlanned={togglePlanned}
            />
          ))}
        </section>
      )}

      {/* 空状态占位 — 引导用户使用右上角加号按钮添加第一个百科卡片 */}
      {!loading && visible.length === 0 && (
        <div className="mt-12 flex flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full bg-muted p-5 ring-1 ring-border">
            <Building2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {t("encyclopedia.empty", { defaultValue: "暂无百科记录" })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("encyclopedia.emptyHint", { defaultValue: "点击右上角加号按钮添加第一个百科卡片" })}
            </p>
          </div>
        </div>
      )}

      {/* 一键清空“下一站”确认弹窗 — 对齐美食模块 AlertDialog 样式 */}
      <AlertDialog open={clearPlannedOpen} onOpenChange={setClearPlannedOpen}>
        <AlertDialogContent className="z-[80] max-w-sm rounded-2xl border-border bg-card p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{isEn ? "Clear Next Stop Marks" : "清空下一站标记"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isEn
                ? 'Clear all "Next Stop" marks in this trip?'
                : "确定一键清空所有“下一站”标记吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setClearPlannedOpen(false);
                void clearAllPlanned();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isEn ? "Clear All" : "一键清空"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 编辑模式弹窗（点击已有卡片） */}
      <MuseumDetail
        museum={active}
        onClose={() => setOpenId(null)}
        onSave={saveMuseum}
        onTogglePlanned={togglePlanned}
        onDelete={deleteMuseum}
        tripId={tripId}
      />

      {/* 新建模式弹窗 */}
      {isNewModalOpen && (
        <MuseumDetail
          museum={newMuseumDraft}
          isNew
          onClose={() => setIsNewModalOpen(false)}
          onSave={saveMuseum}
          onTogglePlanned={togglePlanned}
          tripId={tripId}
        />
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-8 rounded-full px-3 text-xs font-medium transition-all ${
        active
          ? "bg-brand/10 border border-brand/50 text-brand"
          : "bg-muted text-muted-foreground border border-border hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
