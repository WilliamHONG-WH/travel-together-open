import { Moon, Sun, Laptop, Check } from "lucide-react";
import { useTheme, type Theme } from "@/theme/theme-provider";
import { useI18n, useT } from "@/i18n";
import { cn } from "@/lib/utils";

/* ============================================================
 * ThemeToggle — 主题切换胶囊按钮
 * ------------------------------------------------------------
 * 样式与 Language Switcher 完全一致：半透明微圆角胶囊卡片
 * 用于 Auth Page 顶部左侧 / Home Page 顶部右侧（语言按钮左侧）
 * 点击在 light/dark 间极速切换（跳过 system）
 * ============================================================ */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { locale } = useI18n();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  const isZh = locale === "zh";

  // 文案与图标表示【点击后切换到的目标主题】而非当前主题
  // 深色模式 → 显示 ☀️ 浅/Light（点击变浅色）
  // 浅色模式 → 显示 🌙 深/Dark（点击变深色）
  const label = isDark
    ? isZh
      ? "浅"
      : t("theme.light")       // 目标：浅色
    : isZh
      ? "深"
      : t("theme.dark");       // 目标：深色

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-all",
        isDark
          ? "text-slate-200 border-slate-700/50 bg-slate-800/50"
          : "text-slate-800 border-slate-300 bg-white/80",
        className,
      )}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-slate-200" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-slate-800" />
      )}
      <span>{label}</span>
    </button>
  );
}

/* ============================================================
 * ThemeSettingsCard — 设置页主题模式选择卡片
 * ------------------------------------------------------------
 * 提供 [浅色 / 深色 / 跟随系统] 三个 Tab 选项
 * 用于 Settings Page，与"语言"卡片同级
 * ============================================================ */
export function ThemeSettingsCard() {
  const { theme, setTheme } = useTheme();
  const t = useT();

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Laptop },
  ];

  return (
    <section
      className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sun className="h-4 w-4 text-brand" />
        {t("settings.theme")}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("settings.themeDesc")}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-all",
                active
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex items-center gap-1">
                {active && <Check className="h-3 w-3" />}
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
