import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 统一邮票（打卡）数据类型。
 * 该类型是 Map、Footprints、DetailSheet 等模块的共同契约。
 *
 * 数据源统一从 Supabase `user_stamps` 表读取（写入仍同时写
 * `checkins` 与 `user_stamps` 以保持旧版聊天分享等模块的兼容）。
 */
export type Checkin = {
  id: string;
  trip_id: string;
  user_id: string;
  title: string;
  note: string | null;
  image_url: string | null;
  lat: number;
  lng: number;
  created_at: string;
  category: string | null;
  city: string | null;
  country: string | null;
  is_featured: boolean | null;
};

/**
 * 联合查询键：Map、Footprints 共用同一组 cache，任意模块写入后
 * 另一模块通过 invalidateQueries({ queryKey: ["userStamps", tripId] })
 * 即可即时刷新。
 */
export const USER_STAMPS_KEY = (tripId: string) => ["userStamps", tripId] as const;

/**
 * 轻量列表字段：地图/足迹网格/邮票集初始化加载时使用。
 * 排除 notes（长文本），仅请求渲染 marker/卡片所需的基本字段。
 * notes 等详情字段在打开详情弹窗时按需加载（stampDetailQueryOptions）。
 */
const STAMP_COLUMNS_LIGHT =
  "id, trip_id, created_by, title, city, country, photo_url, category, latitude, longitude, created_at, is_featured";

/** 全量字段（含 notes 长文本），仅在查询单条详情时使用 */
const STAMP_COLUMNS_FULL =
  "id, trip_id, created_by, title, city, country, photo_url, notes, category, latitude, longitude, created_at, is_featured";

/**
 * 单条打卡详情查询：打开详情弹窗时按 id 加载全量数据（含 notes）。
 * 列表查询只返回轻量字段，notes 在此处补齐。
 */
export function stampDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["stampDetail", id],
    queryFn: async (): Promise<Checkin | null> => {
      // 安全校验：id 为空时直接返回 null，避免 .eq("id", undefined) 导致 API 异常
      if (!id) return null;
      const { data: row, error } = await (supabase as any)
        .from("user_stamps")
        .select(STAMP_COLUMNS_FULL)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!row) return null;
      return {
        id: row.id,
        trip_id: row.trip_id,
        user_id: row.created_by,
        title: row.title ?? "Untitled",
        note: row.notes ?? null,
        image_url: row.photo_url ?? null,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        created_at: row.created_at,
        category: row.category ?? null,
        city: row.city ?? null,
        country: row.country ?? null,
        is_featured: row.is_featured ?? false,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * 从 `user_stamps` 读取该 trip 所有打卡。
 * 返回值在内部规范化为统一的 Checkin 形状（lat/lng 来自 latitude/longitude，
 * user_id 来自 created_by，note 来自 notes，image_url 来自 photo_url，city 透传）。
 */
export function userStampsQueryOptions(tripId: string) {
  return queryOptions({
    queryKey: USER_STAMPS_KEY(tripId),
    queryFn: async (): Promise<Checkin[]> => {
      // 安全校验：tripId 为空时直接返回空数组，避免 API 传入 undefined 导致 400
      if (!tripId) return [];
      // 轻量查询：仅请求基本字段（不含 notes 长文本），减少 Egress 流量
      // 不做 limit 截断：拉取该行程全部打卡，避免历史打卡点丢失
      const { data, error } = await (supabase as any)
        .from("user_stamps")
        .select(STAMP_COLUMNS_LIGHT)
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // notes 在列表查询中为 null，详情弹窗通过 stampDetailQueryOptions 按需加载
      return (data ?? []).map((row: any): Checkin => ({
        id: row.id,
        trip_id: row.trip_id,
        user_id: row.created_by,
        title: row.title ?? "Untitled",
        note: null,
        image_url: row.photo_url ?? null,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        created_at: row.created_at,
        category: row.category ?? null,
        city: row.city ?? null,
        country: row.country ?? null,
        is_featured: row.is_featured ?? false,
      }));
    },
    // 10min 缓存新鲜期：Tab 频繁切换时直接渲染缓存数据，避免重复请求 Supabase
    staleTime: 10 * 60_000,
  });
}
