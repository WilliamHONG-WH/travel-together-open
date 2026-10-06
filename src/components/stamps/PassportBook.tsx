import { useMemo } from "react";
import { Hourglass, Shuffle, Share2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { StampEntry } from "./types";
import { PostageStamp, aspectFor } from "./PostageStamp";

interface Props {
  featured: StampEntry[];
  onSelect: (entry: StampEntry) => void;
  emptyLabel?: string;
  /** 点击导出按钮：打开精选邮票明信片导出弹窗 (精选优先/无星标取全量由父级决定) */
  onExport?: () => void;
}

type SortMode = "time" | "shuffle";

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function PassportBook({ featured, onSelect, emptyLabel, onExport }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [sortMode, setSortMode] = useState<SortMode>("time");
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => Date.now());

  const ordered = useMemo(() => {
    if (sortMode === "shuffle") return seededShuffle(featured, shuffleSeed);
    return featured.slice().sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  }, [featured, sortMode, shuffleSeed]);

  const handleShuffleClick = () => {
    if (sortMode === "shuffle") setShuffleSeed(Date.now());
    else setSortMode("shuffle");
  };

  return (
    <div className="mt-2 flex w-full flex-col">
      {/* 1. TIME / SHUFFLE 控制栏 + 右侧导出胶囊按钮 */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-muted p-0.5 ring-1 ring-border">
          <button
            type="button"
            onClick={() => setSortMode("time")}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all ${
              sortMode === "time"
                ? "bg-brand/15 text-brand ring-1 ring-brand/40"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Hourglass className="h-3 w-3" />
            Time
          </button>
          <button
            type="button"
            onClick={handleShuffleClick}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all ${
              sortMode === "shuffle"
                ? "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shuffle className="h-3 w-3" />
            Shuffle
          </button>
        </div>
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-sm transition-all active:scale-95 hover:bg-teal-700 dark:bg-brand dark:text-slate-950 dark:hover:brightness-110"
          >
            <Share2 className="h-3 w-3" />
            {isEn ? "Export" : "导出"}
          </button>
        )}
      </div>

      {/* 2. 替代底板的极细分割线 */}
      <div className="my-3 w-full border-t border-border" />

      {/* 3. 无气泡底板，1 行 3 张锯齿邮票 */}
      {ordered.length === 0 ? (
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {emptyLabel ??
              "No featured stamps yet. Star your favorite footprints to add them to your passport!"}
          </p>
        </div>
      ) : (
        <div className="columns-3 gap-4 space-y-4 w-full px-0.5">
          {ordered.map((s) => (
            <div key={s.id} className="break-inside-avoid mb-4 w-full">
              <PostageStamp
                entry={s}
                aspect={aspectFor(s.id)}
                onClick={() => onSelect(s)}
                className=""
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
