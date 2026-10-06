import { useEffect, useMemo, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { tripLocationsQueryOptions, locationChannelName } from "@/lib/user-locations";
import { hashHue } from "@/lib/member-filter";
import { MemberAvatar } from "@/components/member-avatar";
import { useT, useI18n } from "@/i18n";

const TTL_MS = 30 * 60 * 1000;

type LiveLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
};

/**
 * 成员位置 Markers 组件
 *
 * 数据来源：
 * 1. 初始查询：tripLocationsQueryOptions（从 DB 获取成员列表 + sharing_enabled + profiles）
 * 2. 实时更新：Realtime Broadcast（channel: trip_locations:{tripId}，event: location_update）
 *    GPS 坐标不再写入 DB，改由 Broadcast 实时推送，降低 Egress 流量。
 */
export function MemberMarkers({
  tripId,
  hiddenIds,
  currentUserId,
}: {
  tripId: string;
  hiddenIds: Set<string>;
  currentUserId: string | null;
}) {
  const { data: initialLocations } = useSuspenseQuery(tripLocationsQueryOptions(tripId));
  const [now, setNow] = useState(() => Date.now());

  // 实时位置缓存：userId → 最新位置（来自 Broadcast）
  const [liveLocations, setLiveLocations] = useState<Map<string, LiveLocation>>(new Map());

  // Realtime Broadcast 订阅
  useEffect(() => {
    const channel = supabase
      .channel(locationChannelName(tripId))
      .on("broadcast", { event: "location_update" }, (payload: any) => {
        const { userId, lat, lng, updatedAt } = payload;
        if (!userId || lat == null || lng == null) return;
        setLiveLocations((prev) => {
          const next = new Map(prev);
          next.set(userId, { lat, lng, updatedAt });
          return next;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  // Refresh "now" every 60s so stale members fade out
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const visible = useMemo(() => {
    return initialLocations
      .filter(
        (m) =>
          m.user_id !== currentUserId &&
          !hiddenIds.has(m.user_id),
      )
      .map((m) => {
        // 优先使用 Broadcast 实时位置，降级到 DB 初始位置
        const live = liveLocations.get(m.user_id);
        const lat = live?.lat ?? m.lat;
        const lng = live?.lng ?? m.lng;
        const updatedAt = live?.updatedAt ?? m.updated_at;
        return { ...m, lat, lng, updatedAt };
      })
      .filter((m) => m.lat != null && m.lng != null && now - new Date(m.updatedAt).getTime() <= TTL_MS);
  }, [initialLocations, liveLocations, hiddenIds, currentUserId, now]);

  return (
    <>
      {visible.map((m) => (
        <Marker key={m.user_id} longitude={m.lng} latitude={m.lat} anchor="center">
          <MemberBadge
            userId={m.user_id}
            name={m.display_name}
            avatarUrl={m.avatar_url}
            updatedAt={m.updatedAt}
          />
        </Marker>
      ))}
    </>
  );
}

function MemberBadge({
  userId,
  name,
  avatarUrl,
  updatedAt,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  updatedAt: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const hue = hashHue(userId);
  const ring = `hsl(${hue} 75% 55%)`;
  const displayName = name || t("common.traveler");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-background transition-transform active:scale-95"
          style={{ boxShadow: `0 0 0 2px ${ring}, 0 0 0 3px #FFFFFF, 0 1px 2px rgba(0,0,0,0.15)` }}
          aria-label={displayName}
        >
          {/* 全站统一 MemberAvatar：真实头像 → 专属色首字母圆（与队员栏/票据卡片一致） */}
          <MemberAvatar
            fallbackId={userId}
            fallbackName={name}
            fallbackAvatar={avatarUrl}
            textClassName="text-xs font-semibold"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-auto px-3 py-2 text-xs">
        <div className="font-medium text-foreground">{displayName}</div>
        <div className="text-muted-foreground">
          {t("map.refreshedAt")}{" "}
          {formatDistanceToNowStrict(new Date(updatedAt), {
            addSuffix: true,
            locale: locale === "zh" ? zhCN : enUS,
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
