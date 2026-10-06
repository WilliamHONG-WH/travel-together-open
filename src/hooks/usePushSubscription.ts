import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";

const SW_URL = "/sw.js";

/** VAPID 公钥（Base64-URL）→ Uint8Array（subscribe 要求） */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function getVapidKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Web Push 订阅管理：
 * - 开启：请求系统通知权限 → 订阅 pushManager → 同步写入 Supabase user_push_subscriptions
 * - 关闭：删除表中订阅行 → 取消 pushManager 订阅
 * - 初始状态由「本地是否存在有效订阅」推导，页面刷新后开关依然准确
 */
export function usePushSubscription(tripId: string, userId: string | undefined) {
  const t = useT();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [toggling, setToggling] = useState(false);

  const pushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const vapidReady = getVapidKey() !== null;

  // 初始化：检查本设备是否已有有效推送订阅
  useEffect(() => {
    if (!pushSupported) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL);
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPushEnabled(!!sub);
      } catch {
        // SW 注册失败视为未开启
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushSupported]);

  const enablePush = useCallback(async () => {
    if (!userId) return;
    const vapidKey = getVapidKey();
    if (!vapidKey) {
      toast.error(t("settings.pushNoVapid"));
      return;
    }
    setToggling(true);
    try {
      // 1. 请求浏览器/系统通知权限
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(t("settings.pushBlocked"));
        return;
      }

      // 2. 注册 SW 并订阅推送
      const reg = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error(t("settings.pushFailed"));
      }

      // 3. 同步订阅到 Supabase（UNIQUE(user_id, endpoint) 幂等 upsert）
      const { error } = await supabase.from("user_push_subscriptions").upsert(
        {
          user_id: userId,
          trip_id: tripId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,endpoint" },
      );
      if (error) throw error;

      setPushEnabled(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.pushFailed"));
    } finally {
      setToggling(false);
    }
  }, [tripId, userId, t]);

  const disablePush = useCallback(async () => {
    if (!userId) return;
    setToggling(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = reg ? await reg.pushManager.getSubscription() : null;

      // 1. 先删表行（需要 endpoint 定位），再取消本地订阅
      if (sub) {
        await supabase
          .from("user_push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setPushEnabled(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.pushFailed"));
    } finally {
      setToggling(false);
    }
  }, [userId, t]);

  const togglePush = useCallback(
    (next: boolean) => {
      if (next) void enablePush();
      else void disablePush();
    },
    [enablePush, disablePush],
  );

  return {
    pushEnabled,
    pushSupported: pushSupported && vapidReady,
    checking,
    toggling,
    togglePush,
  };
}
