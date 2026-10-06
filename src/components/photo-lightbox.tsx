import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { SignedImage } from "@/components/signed-image";
import type { Checkin } from "@/lib/checkins";
import type { TripMember } from "@/lib/trip-members";
import { formatTime } from "@/lib/timeline-utils";
import { useT } from "@/i18n";

export function PhotoLightbox({
  items,
  index,
  memberById,
  onClose,
  onIndexChange,
}: {
  items: Checkin[];
  index: number | null;
  memberById: Map<string, TripMember>;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const t = useT();
  const touchStartX = useRef<number | null>(null);
  const [current, setCurrent] = useState(index ?? 0);

  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current, items.length]);

  if (index === null || items.length === 0) return null;
  const checkin = items[current];
  if (!checkin) return null;
  const member = memberById.get(checkin.user_id);
  const name = member?.display_name ?? t("common.teammate");

  function go(delta: number) {
    const next = (current + delta + items.length) % items.length;
    setCurrent(next);
    onIndexChange(next);
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-black/95 backdrop-blur-xl"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t("common.close")}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <X className="h-5 w-5" />
      </button>

      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={t("photo.prev")}
            className="absolute left-2 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur md:flex"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t("photo.next")}
            className="absolute right-2 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur md:flex"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div
        className="flex flex-1 items-center justify-center px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {checkin.image_url ? (
          <SignedImage
            path={checkin.image_url}
            alt={checkin.title}
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
          />
        ) : (
          <div className="text-white/60">{t("photo.noPhoto")}</div>
        )}
      </div>

      <div
        className="mx-auto w-full max-w-lg px-5 pb-6 pt-3 text-white"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-white/70">
          {name} · {formatTime(checkin.created_at)}
          {items.length > 1 && (
            <span className="ml-2 text-white/50">
              {current + 1} / {items.length}
            </span>
          )}
        </div>
        <div className="mt-1 text-base font-semibold">{checkin.title}</div>
        {checkin.note && (
          <div className="mt-1 line-clamp-2 text-sm text-white/70">
            {checkin.note}
          </div>
        )}
      </div>
    </div>
  );
}
