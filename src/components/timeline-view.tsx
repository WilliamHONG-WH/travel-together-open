import { useNavigate } from "@tanstack/react-router";
import { MapPin, Building2 } from "lucide-react";
import { SignedImage, CachedImage } from "@/components/signed-image";
import { Button } from "@/components/ui/button";
import { hashHue } from "@/lib/member-filter";
import type { Checkin } from "@/lib/checkins";
import type { TripMember } from "@/lib/trip-members";
import { getCategoryConfig } from "@/lib/checkin-categories";
import { formatTime, groupCheckinsByDay, groupCheckinsByCity } from "@/lib/timeline-utils";
import { useT, useI18n } from "@/i18n";
import { getLocalizedLocationName } from "@/utils/location";

export function TimelineView({
  tripId,
  checkins,
  memberById,
  onOpenPhoto,
  groupMode = "day",
}: {
  tripId: string;
  checkins: Checkin[];
  memberById: Map<string, TripMember>;
  onOpenPhoto: (checkin: Checkin) => void;
  groupMode?: "day" | "city";
}) {
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";

  const dayGroups = groupMode === "day" ? groupCheckinsByDay(checkins, locale) : [];
  const cityGroups = groupMode === "city" ? groupCheckinsByCity(checkins, locale) : [];

  const openOnMap = (checkinId: string) => {
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: { focus: checkinId },
    });
  };

  // Shared renderer for a single checkin card
  const renderCheckinCard = (c: Checkin) => {
    const member = memberById.get(c.user_id);
    const name = member?.display_name ?? t("common.teammate");
    const hue = hashHue(c.user_id);
    const initial = name.trim().charAt(0).toUpperCase() || "?";
    const catConfig = getCategoryConfig(c.category);
    const CatIcon = catConfig.icon;
    return (
      <li key={c.id} className="relative mb-5 last:mb-0">
        <span
          aria-hidden
          className="absolute -left-[27px] top-3 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-background"
          style={{ background: `hsl(${hue} 65% 55%)` }}
        />
        <article className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur">
          <header className="flex items-center gap-2.5 px-3.5 pt-3">
            {member?.avatar_url ? (
              <CachedImage
                value={member.avatar_url}
                bucket="avatars"
                alt={name}
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full object-cover"
                style={{ boxShadow: `0 0 0 2px hsl(${hue} 75% 55%)` }}
              />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: `hsl(${hue} 65% 45%)` }}
              >
                {initial}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatTime(c.created_at)}
              </div>
            </div>
          </header>

          {c.image_url && (
            <button
              type="button"
              onClick={() => onOpenPhoto(c)}
              className="mt-3 block w-full overflow-hidden bg-muted"
              aria-label={t("timeline.viewLargePhoto")}
            >
              <SignedImage
                path={c.image_url}
                alt={c.title}
                className="h-56 w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
              />
            </button>
          )}

          <div className="px-3.5 py-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${catConfig.color}`}>
                <CatIcon className="h-3 w-3" />
                {t(catConfig.labelKey)}
              </span>
              {groupMode === "city" && c.city && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] text-primary">
                  <MapPin className="h-3 w-3" />
                  {getLocalizedLocationName(c.city, locale)}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {c.title}
            </h3>
            {c.note && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                {c.note}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openOnMap(c.id)}
                className="h-8 gap-1.5 text-primary hover:text-primary"
              >
                <MapPin className="h-3.5 w-3.5" />
                {t("timeline.viewOnMap")}
              </Button>
            </div>
          </div>
        </article>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-4">
      {groupMode === "day"
        ? dayGroups.map((group) => (
            <section key={group.key} className="mb-6">
              <div className="sticky top-0 z-10 -mx-4 mb-3 bg-gradient-to-b from-background via-background/95 to-background/70 px-4 py-2 backdrop-blur">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold tracking-wide text-primary">
                    {t("timeline.day", { n: group.dayIndex })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.dateLabel} · {group.weekday}
                  </span>
                </div>
              </div>
              <ol className="relative ml-2 border-l border-border/60 pl-5">
                {group.items.map(renderCheckinCard)}
              </ol>
            </section>
          ))
        : cityGroups.map((group) => (
            <section key={group.key} className="mb-6">
              <div className="sticky top-0 z-10 -mx-4 mb-3 bg-gradient-to-b from-background via-background/95 to-background/70 px-4 py-2 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold tracking-wide text-primary">
                    {getLocalizedLocationName(group.cityName, locale)}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {group.total} {isEn ? "check-ins" : "个打卡"}
                  </span>
                </div>
              </div>
              <ol className="relative ml-2 border-l border-border/60 pl-5">
                {group.items.map(renderCheckinCard)}
              </ol>
            </section>
          ))}
    </div>
  );
}
