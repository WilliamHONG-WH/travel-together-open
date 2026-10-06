import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { twemojiUrl, type StampEntry } from "./types";
import { useI18n } from "@/i18n";
import { getLocalizedLocationText } from "@/utils/location";

interface Props {
  entry: StampEntry | null;
  onClose: () => void;
  onViewFeed?: () => void;
}

export function UnlockModal({ entry, onClose, onViewFeed }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [phase, setPhase] = useState<"drop" | "stamp" | "burst">("drop");

  useEffect(() => {
    if (!entry) return;
    setPhase("drop");
    const t1 = setTimeout(() => setPhase("stamp"), 500);
    const t2 = setTimeout(() => setPhase("burst"), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [entry]);

  if (!entry) return null;

  const handleViewFeed = () => {
    onViewFeed?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-[90%] max-w-sm overflow-hidden rounded-3xl border border-brand/30 bg-card p-8 text-center shadow-[0_0_60px_rgba(0,191,165,0.3)]" onClick={(e) => e.stopPropagation()}>
        {phase === "burst" && (
          <>
            <div className="pointer-events-none absolute left-1/2 top-24 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand opacity-0 animate-ping-slow" />
            <div className="pointer-events-none absolute left-1/2 top-24 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand/50 opacity-0 animate-ping-slower" />
          </>
        )}
        <div className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.3em] text-brand">
          <Sparkles className="h-3.5 w-3.5" />{isEn ? "New Footprint Added" : "新足迹已添加"}
        </div>
        <div className="relative mt-6 flex h-48 items-center justify-center">
          <div className={`flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br ${entry.accent} text-6xl ring-4 ring-brand/40 shadow-[0_0_40px_rgba(0,191,165,0.6)] transition-all duration-500 ${
            phase === "drop" ? "-translate-y-16 scale-150 opacity-0" : phase === "stamp" ? "translate-y-0 scale-90 opacity-100" : "translate-y-0 scale-100 opacity-100 animate-bounce-once"
          }`}>
            <img src={twemojiUrl(entry.iconCode)} alt="" className="h-20 w-20" draggable={false} />
          </div>
        </div>
        <h2 className="mt-4 text-2xl font-bold text-foreground">{entry.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {getLocalizedLocationText(entry.city ?? "", entry.country ?? "", locale) || entry.location}
        </p>
        <p className="mx-auto mt-2 text-xs font-medium uppercase tracking-wider text-brand">checked in by {entry.creator.name}</p>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">{entry.description}</p>
        <button
          type="button"
          onClick={handleViewFeed}
          className="mt-8 w-full rounded-full bg-brand py-3 text-sm font-semibold text-brand-foreground transition-all hover:bg-brand/90 hover:shadow-[0_0_20px_rgba(0,191,165,0.6)] active:scale-[0.98]"
        >
          {isEn ? "View in Feed" : "查看足迹"}
        </button>
      </div>
    </div>
  );
}
