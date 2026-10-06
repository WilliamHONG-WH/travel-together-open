import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// ---------- localStorage 持久化：last_read_chat_at ----------

const keyOf = (tripId: string) => `chat-last-read:${tripId}`;

function readLastRead(tripId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyOf(tripId));
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function writeLastRead(tripId: string, ts: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyOf(tripId), String(ts));
  } catch {
    // localStorage 不可用时静默降级（仅内存态）
  }
}

/** 首次使用（无历史记录）时以当前时间为基线，历史消息不计入未读 */
function ensureLastRead(tripId: string): number {
  const existing = readLastRead(tripId);
  if (existing !== null) return existing;
  const now = Date.now();
  writeLastRead(tripId, now);
  return now;
}

/** 统计晚于 lastRead 且非当前用户发送的消息总数（head count，不拉取数据行） */
async function fetchUnreadCount(
  tripId: string,
  userId: string,
  lastRead: number,
): Promise<number> {
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .neq("user_id", userId)
    .gt("created_at", new Date(lastRead).toISOString());
  if (error) return 0;
  return count ?? 0;
}

/**
 * 群聊未读消息计数（实时）。
 * - 处于群聊 Tab：收到新消息即滚动 last_read 基线，不累计未读；
 * - 不在群聊 Tab：收到他人的新消息未读数 +1；
 * - 进入群聊 Tab 时立即清零并持久化 last_read。
 */
export function useChatUnread(tripId: string) {
  const location = useLocation();
  const isChatActive = location.pathname.endsWith("/chat");

  const [userId, setUserId] = useState<string | null>(null);
  const [lastRead, setLastRead] = useState<number>(() => ensureLastRead(tripId));
  const [unreadCount, setUnreadCount] = useState(0);

  // realtime 回调是长生命周期闭包，用 ref 读取最新值
  const userIdRef = useRef<string | null>(null);
  const isChatActiveRef = useRef(isChatActive);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    isChatActiveRef.current = isChatActive;
  }, [isChatActive]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // 切换行程时重置基线与计数
  useEffect(() => {
    setLastRead(ensureLastRead(tripId));
    setUnreadCount(0);
  }, [tripId]);

  // 基线/身份变化时从服务端校准一次未读总数（兜底离线期间的漏计）
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchUnreadCount(tripId, userId, lastRead).then((n) => {
      if (!cancelled) setUnreadCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, userId, lastRead]);

  // Realtime：新消息 INSERT 增量计数
  useEffect(() => {
    const channel = supabase
      .channel(`messages-unread:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const row = payload.new as { user_id: string | null };
          // 自己发的消息不计入未读
          if (!row.user_id || row.user_id === userIdRef.current) return;
          if (isChatActiveRef.current) {
            // 正在群聊 Tab：视为已读，自动更新 last_read_chat_at
            const now = Date.now();
            writeLastRead(tripId, now);
            setLastRead(now);
          } else {
            setUnreadCount((c) => c + 1);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    writeLastRead(tripId, now);
    setLastRead(now);
    setUnreadCount(0);
  }, [tripId]);

  // 进入群聊 Tab：角标立即消失、计数清零
  useEffect(() => {
    if (isChatActive) markAllRead();
  }, [isChatActive, markAllRead]);

  return { unreadCount, markAllRead };
}
