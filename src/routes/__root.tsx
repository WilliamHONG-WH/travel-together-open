import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { I18nProvider, useT } from "@/i18n";
import { ThemeProvider, useTheme } from "@/theme/theme-provider";

/**
 * 根级 NotFoundComponent：包裹 I18nProvider，确保在 RootComponent 崩溃
 * （I18nProvider 未挂载）时仍能正确显示翻译，而非显示 key 字符串。
 */
function NotFoundComponent() {
  return (
    <I18nProvider>
      <NotFoundComponentInner />
    </I18nProvider>
  );
}

function NotFoundComponentInner() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">{t("root.notFoundTitle")}</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("root.trailNotFound")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.notFoundDesc")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("root.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * 根级 ErrorComponent：包裹 I18nProvider，确保在 RootComponent 崩溃
 * （I18nProvider 未挂载）时仍能正确显示翻译，而非显示 key 字符串。
 */
// @tanstack/react-start 升级后 ErrorComponentProps.error 由 Error 变为 unknown，
// 此处用类型断言保持既有错误处理逻辑不变
function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <I18nProvider>
      <ErrorComponentInner error={error as Error} reset={reset} />
    </I18nProvider>
  );
}

function ErrorComponentInner({ error, reset }: { error: Error; reset: () => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("root.errorTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.errorDesc")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("root.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("root.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // 优化移动端视口：禁止双指缩放，支持 iPhone 刘海屏全屏扩展 (viewport-fit=cover)
      { name: "viewport", content: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" },
      // 开启 iOS Safari Web App 全屏/独立应用模式（从主屏启动时隐藏 Safari 顶部地址栏与底部导航栏）
      { name: "apple-mobile-web-app-capable", content: "yes" },
      // iOS 状态栏样式：适配暗色主题，支持刘海屏沉浸式全屏（状态栏背景透明，内容延伸至顶部）
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      // 添加到主屏幕时显示的默认 APP 名称
      { name: "apple-mobile-web-app-title", content: "山海同行" },
      // theme-color 由 ThemeProvider 运行时动态更新；此处初始值匹配浅色默认背景
      { name: "theme-color", content: "#F8FAFC" },
      { title: "山海同行 | Travel Together" },
      {
        name: "description",
        content:
          "Plan trips, drop photo checkins on a live map, share your real-time location and chat with your travel crew.",
      },
      { property: "og:title", content: "山海同行 | Travel Together" },
      {
        property: "og:description",
        content: "A shared map, photo checkins, live location and chat for your travel crew.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // Font optimization: open early connections to Google Fonts hosts so the
      // Zhi Mang Xing calligraphy font can start downloading on the first paint.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&family=Courgette&display=block",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&family=Courgette&display=block",
      },
      // 预加载本地艺术字体 YuFanXinYu-Regular（主页"山海同行"标题实际使用字重，2.3MB）
      // 配合 styles.css 中的 font-display: block，彻底消除首屏 FOUT 闪烁
      {
        rel: "preload",
        as: "font",
        href: "/fonts/YuFanXinYu-Regular.ttf",
        type: "font/ttf",
        crossOrigin: "anonymous",
      },
      // 预加载本地 Iceland 字体（仅 47KB，英文标题"TRAVEL TOGETHER"使用）
      // 本地零延迟加载，配合 font-display: swap 实现秒开无留白
      {
        rel: "preload",
        as: "font",
        href: "/fonts/Iceland-Regular.ttf",
        type: "font/ttf",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
      // 浏览器 Favicon 统一使用 LOGO-2.svg；iOS Safari "添加到主屏幕" 使用 PNG（iOS 不支持 SVG）
      { rel: "icon", href: "/LOGO-2.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      // PWA Manifest — display:standalone 是消除 iOS Safari 导航栏与刷新按钮的核心
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // 防闪烁内联脚本：在 React hydration 之前，根据 localStorage 缓存或系统偏好
  // 为 <html> 添加 .dark 类，避免浅色模式用户首屏看到深色闪烁（FOUC）
  const themeInitScript = `(function(){try{var t=localStorage.getItem('app-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t||t==='system')&&d){document.documentElement.classList.add('dark');}var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content',(t==='dark'||((!t||t==='system')&&d))?'#01172a':'#F8FAFC');}}catch(e){}})();`;
  // suppressHydrationWarning: 防闪烁脚本会在 hydration 前修改 <html> 的 class 与 <meta> 内容，
  // 这是预期行为（避免 FOUC），React 19 通过此属性忽略该差异
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* 内联背景色：CSS 加载前防止白屏闪烁；margin/padding:0 消除上下白边
       * 背景色用浅色（默认），.dark 由防闪烁脚本提前添加 */}
      <body style={{ backgroundColor: "#F8FAFC", margin: 0, padding: 0 }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  // 断网重连 / 后台切回自愈：当页面重新可见或网络恢复时，强制解锁 body 滚动与
  // 全局 Pointer Events，防止断网挂起或后台切换导致界面冻结、无法触控滑动
  useEffect(() => {
    const handleVisibilityOrOnline = () => {
      if (document.visibilityState === "visible" || navigator.onLine) {
        document.body.style.overflow = "unset";
        document.body.style.pointerEvents = "auto";
      }
    };
    window.addEventListener("visibilitychange", handleVisibilityOrOnline);
    window.addEventListener("online", handleVisibilityOrOnline);
    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityOrOnline);
      window.removeEventListener("online", handleVisibilityOrOnline);
    };
  }, []);

  // Web Push：注册 Service Worker（幂等），并监听通知点击的跳转指令
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败（如非 HTTPS 环境）静默降级，推送开关不可用
    });
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_NAVIGATE" && typeof event.data.url === "string") {
        router.history.push(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <ThemedToaster />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Toaster 跟随当前 resolvedTheme 切换 light/dark 样式 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="top-center"
      richColors
      style={{ zIndex: 9999 }}
      toastOptions={{ style: { zIndex: 9999 } }}
    />
  );
}
