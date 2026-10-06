import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Checkin } from "@/lib/checkins";

export type MessageType = "text" | "checkin_share";

export type MessageProfile = {
  display_name: string | null;
  avatar_url: string | null;
};

export type Message = {
  id: string;
  trip_id: string;
  user_id: string;
  content: string;
  type: MessageType;
  checkin_id: string | null;
  created_at: string;
  /** 消息撤回标记（微信同款：撤回后气泡替换为系统弱提示） */
  is_recalled?: boolean;
  /** 拼装挂载：通过前端内存级双查询从 profiles 表查出并挂载 */
  profiles?: MessageProfile | null;
};

// messages 基础列（不含任何 Join，避免触发 schema cache 外键缺失报错）
const BASE_COLUMNS =
  "id, trip_id, user_id, content, type, checkin_id, created_at, is_recalled";

/**
 * 在内存中将 profiles 拼装挂载到 messages 上。
 * 思路：提取 message.user_id 去重后批量查 profiles，再用 Map O(1) 查找拼装。
 */
async function enrichMessagesWithProfiles<T extends { user_id: string | null }>(
  messages: T[],
): Promise<(T & { profiles: MessageProfile | null })[]> {
  if (!messages.length) return messages as (T & { profiles: MessageProfile | null })[];

  // 1. 提取去重后的 user_id 列表
  const userIds = Array.from(
    new Set(messages.map((m) => m.user_id).filter(Boolean) as string[]),
  );

  if (!userIds.length) {
    return messages.map((m) => ({ ...m, profiles: null }));
  }

  // 2. 批量查询 profiles
  const { data: profilesData, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);

  // 3. 降级处理：profile 获取失败时，直接挂载 null
  if (profileError || !profilesData) {
    return messages.map((m) => ({ ...m, profiles: null }));
  }

  // 4. 转为 Map 结构 O(1) 查找
  const profilesMap = new Map(
    profilesData.map((p) => [p.id, p] as const),
  );

  // 5. 内存中拼装
  return messages.map((m) => ({
    ...m,
    profiles: (m.user_id && profilesMap.get(m.user_id)) || null,
  }));
}

export function messagesQueryOptions(tripId: string) {
  return queryOptions({
    queryKey: ["messages", tripId],
    queryFn: async (): Promise<Message[]> => {
      // 第一步：仅查询最近 30 条消息（降序取最新，再正序返回供渲染）
      const { data: messagesData, error: msgError } = await supabase
        .from("messages")
        .select(BASE_COLUMNS)
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (msgError) throw msgError;

      // 反转为正序（旧 → 新）供聊天 UI 渲染
      const ordered = (messagesData ?? []).reverse();

      // 第二步：内存级双查询拼装 profiles
      const enriched = await enrichMessagesWithProfiles(ordered);
      return enriched as Message[];
    },
    // 5min 缓存新鲜期：Tab 频繁切换时直接渲染缓存数据，避免重复请求
    staleTime: 5 * 60_000,
  });
}

export async function sendTextMessage(params: {
  tripId: string;
  userId: string;
  content: string;
}): Promise<Message> {
  // 1. 插入并取回基础列
  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      trip_id: params.tripId,
      user_id: params.userId,
      content: params.content,
      type: "text",
    })
    .select(BASE_COLUMNS)
    .single();
  if (error) throw error;

  // 2. 内存级拼装当前用户的 profile
  const [enriched] = await enrichMessagesWithProfiles([msg]);
  return enriched as Message;
}

/**
 * 撤回消息：将 is_recalled 置为 true，Realtime UPDATE 事件会广播给全团。
 * 注意：无任何时间限制（如"2 分钟内"），任意历史消息均可撤回。
 * RLS 约束：仅消息发送者本人可更新；若 UPDATE policy 缺失，会静默更新 0 行，
 * 此处显式检测 0 行并抛错，避免静默失败。
 */
export async function recallMessage(messageId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("messages")
      .update({ is_recalled: true })
      .eq("id", messageId)
      .select("id");
    if (error) throw new Error(error.message);
    // RLS 缺失 UPDATE policy 时 Postgres "成功"更新 0 行（无错误）——必须显式报错
    if (!data || data.length === 0) {
      throw new Error("no rows updated (check messages UPDATE RLS policy)");
    }
  } catch (e) {
    // 统一转为带 message 的 Error，供上层 toast.error 展示
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function shareCheckinToChat(params: {
  tripId: string;
  userId: string;
  checkin: Pick<Checkin, "id" | "title">;
}): Promise<Message> {
  // 1. 插入并取回基础列
  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      trip_id: params.tripId,
      user_id: params.userId,
      content: params.checkin.title,
      type: "checkin_share",
      checkin_id: params.checkin.id,
    })
    .select(BASE_COLUMNS)
    .single();
  if (error) throw error;

  // 2. 内存级拼装当前用户的 profile
  const [enriched] = await enrichMessagesWithProfiles([msg]);
  return enriched as Message;
}
