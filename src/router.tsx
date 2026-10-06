import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// 模块级单例：避免 Vite HMR 期间 getRouter 被重新调用时创建新的 QueryClient，
// 导致 router context 丢失、RootComponent 崩溃、I18nProvider 未挂载而报
// "useI18n must be used within I18nProvider" 错误。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 全局缓存策略：staleTime 10min 确保 Tab 频繁切换时不重复请求 Supabase，
      // gcTime 30min 保留卸载后的缓存，refetchOnWindowFocus 关闭避免移动端不必要的重拉
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 10 * 60_000,
  });

  return router;
};
