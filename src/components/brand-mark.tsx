import { useId } from "react";
import logoSvgDark from "@/assets/LOGO-2.svg";
import { cn } from "@/lib/utils";
import { useI18n, useT } from "@/i18n";
import { useTheme } from "@/theme/theme-provider";

export function BrandMark({
  size = "md",
  showTitle = true,
  subtitle,
  className,
}: {
  size?: "sm" | "md" | "lg";
  showTitle?: boolean;
  subtitle?: string;
  className?: string;
}) {
  const { locale } = useI18n();
  const t = useT();
  const { resolvedTheme } = useTheme();
  const isZh = locale === "zh";
  const isDark = resolvedTheme === "dark";
  const maskId = useId();

  // 与深色版 LOGO-2.svg 完全一致的容器尺寸
  const logoSize =
    size === "lg"
      ? "w-16 h-16 sm:w-20 sm:h-20"
      : size === "md"
        ? "w-14 h-14 sm:w-16 sm:h-16"
        : "w-12 h-12 sm:w-14 sm:h-14";

  // 浅色模式内联 SVG：与深色版 viewBox / 路径完全一致，仅填充色改为深色
  function LightModeLogo({ className: svgCls }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 90.71 90.7"
        className={cn("mx-auto mb-4", svgCls)}
        fill="none"
      >
        <defs>
          <mask id={maskId}>
            <rect width="90.71" height="90.7" fill="#ffffff" />
            <path
              d="m90.71,45.35v22.68c-8.26,0-16,2.21-22.67,6.06-6.67-3.85-14.42-6.06-22.68-6.06s-16.01,2.21-22.68,6.06c-6.67-3.85-14.42-6.06-22.68-6.06v-22.68c25.05,0,45.35-20.3,45.36-45.35.01,25.05,20.3,45.35,45.35,45.35Z"
              fill="#000000"
            />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`} fill="#0F172A">
          <path d="m90.71,68.03v8.5c0,7.8-6.37,14.17-14.17,14.17H14.18c-7.8,0-14.18-6.37-14.18-14.17v-8.5c8.26,0,16.01,2.21,22.68,6.06,6.67-3.85,14.42-6.06,22.68-6.06s16.01,2.21,22.68,6.06c6.67-3.85,14.41-6.06,22.67-6.06Z" />
          <path d="m90.71,14.17v31.18c-25.05,0-45.34-20.3-45.35-45.35h31.18c7.8,0,14.17,6.37,14.17,14.17Z" />
          <path d="m14.18,0h31.18c-.01,25.05-20.31,45.35-45.36,45.35V14.17C0,6.37,6.38,0,14.18,0Z" />
        </g>
      </svg>
    );
  }

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      {/* 深色模式：原版 LOGO-2.svg 外链图片；浅色模式：同 viewBox 内联 SVG，深色填充 + 透明负空间 */}
      {isDark ? (
        <img
          src={logoSvgDark}
          alt="山海同行 LOGO"
          className={cn("object-contain mx-auto mb-4", logoSize)}
        />
      ) : (
        <LightModeLogo className={logoSize} />
      )}
      {showTitle && (
        <>
          {/* 标题容器固定高度 h-16，隔离中英文高度差异，防止 i18n 切换时下方布局抖动 */}
          <div className="flex h-16 items-center justify-center">
            {isZh ? (
              <h1 className="font-yufan text-4xl sm:text-5xl text-foreground tracking-wide whitespace-nowrap">
                {t("app_name")}
              </h1>
            ) : (
              <h1 className="font-iceland text-3xl sm:text-4xl text-foreground tracking-wider uppercase whitespace-nowrap drop-shadow-[0_0_12px_rgba(13,148,136,0.25)]">
                {t("app_name")}
              </h1>
            )}
          </div>
          {subtitle && (
            <p className="mt-2 text-xs md:text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </>
      )}
    </div>
  );
}
