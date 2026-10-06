import { Link } from "@tanstack/react-router";
import { Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export function TimelineEmpty({ tripId }: { tripId: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)",
          }}
        />
        <div className="flex h-24 w-24 items-center justify-center rounded-full border border-border/60 bg-card/70 text-primary shadow-lg shadow-primary/20 backdrop-blur">
          <Footprints className="h-11 w-11" strokeWidth={1.6} />
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-lg font-semibold text-foreground">
          {t("timeline.emptyTitle")}
        </div>
        <div className="text-sm text-muted-foreground">
          {t("timeline.emptyDesc")}
        </div>
      </div>
      <Button asChild className="mt-1">
        <Link to="/trips/$tripId" params={{ tripId }}>
          {t("timeline.goCheckin")}
        </Link>
      </Button>
    </div>
  );
}
