/* 山海同行 Service Worker：Web Push 通知接收与点击跳转 */
/* eslint-disable no-restricted-globals */

// 收到推送：解析 payload 并弹出原生系统通知
self.addEventListener("push", (event) => {
  let data = { title: "山海同行", body: "你有一条新消息", url: "/" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    // payload 非法（纯文本/空）时回退默认文案
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      tag: "shanhai-chat", // 同 tag 的新通知折叠旧通知，避免刷屏
      renotify: true,
      data: { url: data.url },
    }),
  );
});

// 点击通知：聚焦已打开的 App 窗口，否则新开窗口，并跳转至对应群聊页
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 已有打开的窗口：聚焦并通过 postMessage 通知前端路由跳转
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("postMessage" in client) client.postMessage({ type: "PUSH_NAVIGATE", url });
          return;
        }
      }
      // 没有已打开的窗口：直接打开目标地址
      return self.clients.openWindow(url);
    }),
  );
});
