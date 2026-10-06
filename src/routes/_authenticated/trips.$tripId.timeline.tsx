import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimelineView } from "@/components/timeline-view";
import { PhotoWallView } from "@/components/photo-wall-view";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { TimelineEmpty } from "@/components/timeline-empty";
import { checkinsQueryOptions, type Checkin } from "@/lib/checkins";
import { tripMembersQueryOptions, type TripMember } from "@/lib/trip-members";
import { useT, useI18n } from "@/i18n";

const searchSchema = z.object({
  view: fallback(z.enum(["timeline", "wall", "city"]), "timeline").default("timeline"),
});

export const Route = createFileRoute("/_authenticated/trips/$tripId/timeline")({
  validateSearch: zodValidator(searchSchema),
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(checkinsQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(tripMembersQueryOptions(params.tripId));
  },
  component: TimelinePage,
  errorComponent: ({ error }) => (
    <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
      {(error as Error).message}
    </div>
  ),
  notFoundComponent: TimelineNotFound,
});

function TimelineNotFound() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t("timeline.notFound")}
    </div>
  );
}

function TimelinePage() {
  const { tripId } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";

  const { data: checkins } = useSuspenseQuery(checkinsQueryOptions(tripId));
  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));

  const memberById = useMemo(() => {
    const m = new Map<string, TripMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  const photos = useMemo(
    () => checkins.filter((c) => !!c.image_url),
    [checkins],
  );

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const setView = (v: "timeline" | "wall" | "city") => {
    navigate({
      to: "/trips/$tripId/timeline",
      params: { tripId },
      search: { view: v },
      replace: true,
    });
  };

  const openPhotoFromCheckin = (c: Checkin) => {
    const i = photos.findIndex((p) => p.id === c.id);
    if (i >= 0) setLightboxIndex(i);
  };

  if (checkins.length === 0) {
    return <TimelineEmpty tripId={tripId} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/60 bg-card/60 px-4 pb-3 pt-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Tabs value={view} onValueChange={(v) => setView(v as "timeline" | "wall" | "city")}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="timeline">{t("timeline.tabTimeline")}</TabsTrigger>
              <TabsTrigger value="city">{isEn ? "City" : "城市"}</TabsTrigger>
              <TabsTrigger value="wall">{t("timeline.tabWall")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === "timeline" ? (
          <TimelineView
            tripId={tripId}
            checkins={checkins}
            memberById={memberById}
            onOpenPhoto={openPhotoFromCheckin}
          />
        ) : view === "city" ? (
          <TimelineView
            tripId={tripId}
            checkins={checkins}
            memberById={memberById}
            onOpenPhoto={openPhotoFromCheckin}
            groupMode="city"
          />
        ) : (
          <PhotoWallView
            checkins={checkins}
            memberById={memberById}
            onOpen={(i) => setLightboxIndex(i)}
          />
        )}
      </div>

      <PhotoLightbox
        items={photos}
        index={lightboxIndex}
        memberById={memberById}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}
