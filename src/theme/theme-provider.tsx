import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/* ============================================================
 * ThemeProvider — 浅色 / 深色 / 跟随系统 三态主题管理
 * ------------------------------------------------------------
 * - localStorage 缓存用户选择（key: "app-theme"）
 * - 无缓存时默认跟随系统 prefers-color-scheme
 * - 通过为 <html> 添加/移除 .dark 类切换主题（配合 Tailwind v4 的 @custom-variant dark）
 * - 自动监听系统主题变化（仅当用户选择 "system" 时生效）
 * ============================================================ */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "app-theme";

const ThemeContext = createContext<{
  /** 用户显式选择的主题（可能是 "system"） */
  theme: Theme;
  /** 实际生效的主题（已解析 system → light/dark） */
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
} | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function detectInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

/** 将 resolved theme 应用到 <html> 元素的 .dark class */
function applyThemeClass(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // 同步更新 <meta name="theme-color"> 让 iOS Safari 状态栏匹配
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#01172a" : "#F8FAFC");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(detectInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === "system" ? getSystemTheme() : theme,
  );

  // 应用 .dark 类到 <html>
  useEffect(() => {
    applyThemeClass(resolvedTheme);
  }, [resolvedTheme]);

  // 监听系统主题变化（仅当用户选择 "system" 时生效）
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  // 当用户显式切换主题时，同步 resolvedTheme
  useEffect(() => {
    setResolvedTheme(theme === "system" ? getSystemTheme() : theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, t);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    // 在 light/dark 之间切换（跳过 system，提供"极速切换"体验）
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
