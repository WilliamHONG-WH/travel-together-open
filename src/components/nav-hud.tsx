import { useState } from "react";
import { Footprints, Car, X, ExternalLink, Loader2, Route as RouteIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RouteInfo, NavMode, MapAppLink } from "@/lib/navigation";
import { getDeepLinks } from "@/lib/navigation";
import { useT, useI18n } from "@/i18n";
import { formatDistance, formatDuration } from "@/lib/navigation";

type NavTarget = {
  lat: number;
  lng: number;
  title: string;
};

export function NavHud({
  target,
  userLocation,
  route,
  mode,
  loading,
  onModeChange,
  onClose,
}: {
  target: NavTarget;
  userLocation: { lat: number; lng: number } | null;
  route: RouteInfo | null;
  mode: NavMode;
  loading: boolean;
  onModeChange: (m: NavMode) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [sheetOpen, setSheetOpen] = useState(false);

  const deepLinks: MapAppLink[] = getDeepLinks(target);

  return (
    <>
      {/* HUD card — floating at top-center of map */}
      <div
        className="absolute left-1/2 top-3 z-20 w-[min(92vw,380px)] -translate-x-1/2"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <div
          className="rounded-2xl border border-border bg-card/85 p-3 shadow-lg backdrop-blur-xl"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          {/* Top row: target name + close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <RouteIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate text-sm font-semibold text-foreground">
                {target.title}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
              aria-label={t("nav.stopNav")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode toggle (segmented control) */}
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl border border-border bg-black/25 p-1">
            <button
              type="button"
              onClick={() => onModeChange("foot")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                mode === "foot"
                  ? "bg-gradient-to-r from-[#55E6BD] via-[#18CDB8] to-[#08AAA0] text-[#06211D] shadow-sm"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <Footprints className="h-3.5 w-3.5" />
              {t("nav.walk")}
            </button>
            <button
              type="button"
              onClick={() => onModeChange("driving")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                mode === "driving"
                  ? "bg-gradient-to-r from-[#55E6BD] via-[#18CDB8] to-[#08AAA0] text-[#06211D] shadow-sm"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <Car className="h-3.5 w-3.5" />
              {t("nav.drive")}
            </button>
          </div>

          {/* Distance + ETA */}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            {loading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("nav.calculating")}
              </div>
            ) : route ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {t("nav.distance")}
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {formatDistance(route.distance, locale)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {t("nav.duration")}
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {formatDuration(route.duration, locale)}
                  </span>
                </div>
              </>
            ) : !userLocation ? (
              <span className="text-xs text-muted-foreground">
                {t("map.gettingLocation")}
              </span>
            ) : (
              <span className="text-xs text-destructive">
                {t("nav.routeFailed")}
              </span>
            )}
          </div>

          {/* Open in external maps */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-foreground/5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-[0.98]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("nav.openInMaps")}
          </button>
        </div>
      </div>

      {/* External maps bottom sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="border-border/60 bg-card p-0">
          <SheetHeader className="px-5 pt-4">
            <SheetTitle className="text-base font-semibold text-foreground">
              {t("nav.chooseMap")}
            </SheetTitle>
          </SheetHeader>
          <div className="mx-auto w-full max-w-lg space-y-2 px-5 pb-6 pt-3">
            {deepLinks.map((link) => (
              <a
                key={link.labelKey}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSheetOpen(false)}
                className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 active:scale-[0.99]"
              >
                {t(link.labelKey)}
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
