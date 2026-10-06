/**
 * Vercel Serverless：Web Push 推送派发端点（Node runtime，免费额度内运行）
 *
 * 触发方式：客户端发送群聊消息成功后 fire-and-forget POST /api/send-push
 * Body: { tripId, senderId, title, body, url }
 *
 * 职责：
 * 1. 用 Service Role Key 查询 user_push_subscriptions 中
 *    trip_id 匹配、enabled=true、且 user_id != senderId（不推送给自己）的订阅
 * 2. web-push 批量向 Google/Apple/Mozilla 推送服务器派发通知
 * 3. 410/404 的失效订阅自动清理（设备卸载/注销后 endpoint 过期）
 *
 * 环境变量（Vercel Dashboard → Settings → Environment Variables 配置）：
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  （npx web-push generate-vapid-keys 生成）
 * - VAPID_SUBJECT                        （可选，mailto: 联系方式）
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（Supabase 控制台 → Settings → API）
 */
import type { IncomingHttpHeaders } from "node:http";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

interface VercelRequest {
  method?: string;
  headers: IncomingHttpHeaders;
  body?: {
    tripId?: string;
    senderId?: string;
    title?: string;
    body?: string;
    url?: string;
  };
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(data: unknown): void;
}

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { tripId, senderId, title, body, url } = req.body ?? {};
  if (!tripId || !senderId || !body) {
    return res.status(400).json({ error: "tripId, senderId, body are required" });
  }

  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Push server env vars not configured" });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:noreply@shanhai.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );

  // Service Role Key 绕过 RLS：服务端可读取全队成员的推送订阅
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 查询当前行程中除发送者以外、且 enabled = true 的所有订阅 Token
  const { data: subs, error } = await supabaseAdmin
    .from("user_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("trip_id", tripId)
    .eq("enabled", true)
    .neq("user_id", senderId);
  if (error) return res.status(500).json({ error: error.message });

  const rows = (subs ?? []) as PushSubscriptionRow[];
  if (!rows.length) return res.status(200).json({ sent: 0 });

  const payload = JSON.stringify({
    title: title || "山海同行",
    body,
    url: url || "/",
  });

  // 批量派发；单个失败不影响其他订阅
  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
      ),
    ),
  );

  // 清理失效订阅（410 Gone / 404 Not Found：endpoint 已注销）
  const staleIds: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const statusCode = (r.reason as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) staleIds.push(rows[i].id);
    }
  });
  if (staleIds.length) {
    await supabaseAdmin.from("user_push_subscriptions").delete().in("id", staleIds);
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return res.status(200).json({ sent, cleaned: staleIds.length });
}
