import { memo } from "react";
import { Bookmark } from "lucide-react";
import type { Locale } from "@/i18n/translations";
import { getLocalizedCity, getLocalizedCountry } from "@/constants/locations";
import { PhotoImage } from "@/components/signed-image";
import type { Museum } from "./museumData";

/**
 * 博物馆百科网格单卡片 — React.memo 记忆化：
 * 仅当自身 props 变化（如本卡片 planned 翻转）时重绘，
 * 点击书签时页面上其余所有卡片完全跳过渲染，消除整页重绘卡顿。
 * 生效前提：父级传入的回调（onOpen / onTogglePlanned）必须为 useCallback 固定引用。
 */
export const MuseumCard = memo(function MuseumCard({
  museum: m,
  locale,
  onOpen,
  onTogglePlanned,
}: {
  museum: Museum;
  locale: Locale;
  onOpen: (id: string) => void;
  onTogglePlanned: (id: string) => void;
}) {
  const cityLabel = getLocalizedCity(m.cityKey, locale, m.countryKey);
  const countryLabel = getLocalizedCountry(m.countryKey, locale);
  const locationText = [cityLabel, countryLabel].filter(Boolean).join(", ");

  return (
    <article
      onClick={() => onOpen(m.id)}
      className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card shadow-lg transition-all hover:border-border cursor-pointer"
    >
      {/* 1. 上半部分：铺满图片 + 右上角绿色发光书签 */}
      <div className="relative w-full aspect-square bg-muted shrink-0 overflow-hidden">
        {m.cover ? (
          <PhotoImage
            src={m.cover}
            alt={m.name}
            eager
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-card" />
        )}

        {/* 右上角：琥珀金色发光书签按键 (对齐足迹模块金色星标) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlanned(m.id);
          }}
          aria-label="Toggle planned"
          className={`absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-all active:scale-95 shadow-md ${
            m.planned
              ? "border-amber-400/80 bg-amber-500/20 text-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)]"
              : "border-border/80 bg-muted/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bookmark
            className={`h-3 w-3 ${m.planned ? "fill-amber-400 text-amber-400" : ""}`}
            fill={m.planned ? "currentColor" : "none"}
          />
        </button>
      </div>

      {/* 2. 切割线 */}
      <div className="w-full border-t border-border/80" />

      {/* 3. 下半部分：三行文字区 (标题 / 城市国家 / 营业时间) */}
      <div className="flex flex-1 flex-col justify-between px-2 py-1.5">
        <div>
          <h3 className="truncate text-xs font-bold leading-tight text-foreground">{m.name}</h3>
          {locationText && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
              {locationText}
            </p>
          )}
        </div>
        <div className="mt-1 truncate text-[9px] font-bold leading-none tracking-wider text-brand uppercase">
          {m.hours || "10:00 - 20:00"}
        </div>
      </div>
    </article>
  );
});
