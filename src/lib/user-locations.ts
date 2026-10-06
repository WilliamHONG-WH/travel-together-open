import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MemberLocation = {
  user_id: string;
  trip_id: string;
  lat: number;
  lng: number;
  sharing_enabled: boolean;
  updated_at: string;
  display_name: string;
  avatar_url: string | null;
};

/**
 * 位置共享 channel 命名：trip_locations:{tripId}
 * 使用 Realtime Broadcast 模式，GPS 坐标不写入数据库。
 */
export function locationChannelName(tripId: string) {
  return `trip_locations:${tripId}`;
}

/**
 * 查询开启位置共享的成员列表（仅取 sharing_enabled 状态 + profiles 信息）。
 * lat/lng 不再从 DB 读取，改由 Realtime Broadcast 实时推送。
 * 但仍保留 lat/lng 列以兼容旧数据（作为初始位置，直到收到新广播）。
 */
export function tripLocationsQueryOptions(tripId: string) {
  return queryOptions({
    queryKey: ["user-locations", tripId],
    queryFn: async (): Promise<MemberLocation[]> => {
      const { data: locs, error } = await supabase
        .from("user_locations")
        .select("user_id, trip_id, lat, lng, sharing_enabled, updated_at")
        .eq("trip_id", tripId);
      if (error) throw error;
      const rows = (locs ?? []).filter(
        (r) => r.sharing_enabled,
      );
      if (rows.length === 0) return [];
      const ids = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", ids);
      if (pErr) throw pErr;
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      return rows.map((r) => {
        const p = map.get(r.user_id);
        return {
          user_id: r.user_id,
          trip_id: r.trip_id,
          lat: r.lat as number,
          lng: r.lng as number,
          sharing_enabled: r.sharing_enabled,
          updated_at: r.updated_at,
          display_name: p?.display_name ?? "",
          avatar_url: p?.avatar_url ?? null,
        };
      });
    },
  });
}

// ─── 节流控制 ────────────────────────────────────────────────
// 模块级缓存：记录每个 (tripId, userId) 的上次发送位置和时间
type LastSent = { lat: number; lng: number; ts: number };
const lastSentMap = new Map<string, LastSent>();

const THROTTLE_MIN_DISTANCE_M = 30; // 位置变动 > 30 米才发送
const THROTTLE_MIN_INTERVAL_MS = 15_000; // 时间间隔 > 15 秒才发送

/** Haversine 公式计算两点间距离（米） */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 广播实时位置到 Realtime channel（不写入数据库）。
 *
 * 节流策略：仅在位置变动 > 30 米或时间间隔 > 15 秒时才发送。
 *
 * @returns true 表示已发送，false 表示被节流跳过
 */
export async function broadcastLocation(params: {
  tripId: string;
  userId: string;
  lat: number;
  lng: number;
}): Promise<boolean> {
  const key = `${params.tripId}:${params.userId}`;
  const now = Date.now();
  const last = lastSentMap.get(key);

  // 节流判断
  if (last) {
    const distance = haversineMeters(last.lat, last.lng, params.lat, params.lng);
    const elapsed = now - last.ts;
    if (distance < THROTTLE_MIN_DISTANCE_M && elapsed < THROTTLE_MIN_INTERVAL_MS) {
      return false; // 被节流跳过
    }
  }

  const channel = supabase.channel(locationChannelName(params.tripId));
  const payload = {
    userId: params.userId,
    lat: params.lat,
    lng: params.lng,
    updatedAt: new Date().toISOString(),
  };

  await channel.send({
    type: "broadcast",
    event: "location_update",
    payload,
  });

  lastSentMap.set(key, { lat: params.lat, lng: params.lng, ts: now });
  return true;
}
