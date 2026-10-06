import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { Users, Copy, Search, MapPin, Camera, Crown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { checkinsQueryOptions } from "@/lib/checkins";
import { hashHue } from "@/lib/member-filter";
import { CachedImage } from "@/components/signed-image";
import { copyText } from "@/lib/copy-to-clipboard";
import { useT } from "@/i18n";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/trips/$tripId/members")({
  component: MembersPage,
});

type LocationRow = {
  user_id: string;
  sharing_enabled: boolean;
  updated_at: string;
};

function MembersPage() {
  const { tripId } = Route.useParams();
  const { trip, user } = Route.useRouteContext();
  const t = useT();
  const [search, setSearch] = useState("");

  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));
  const { data: checkins } = useSuspenseQuery(checkinsQueryOptions(tripId));

  // Fetch location sharing status for all members
  const { data: locations } = useQuery<LocationRow[]>({
    queryKey: ["member-locations-status", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_locations")
        .select("user_id, sharing_enabled, updated_at")
        .eq("trip_id", tripId);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Count checkins per user
  const checkinCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of checkins) {
      map.set(c.user_id, (map.get(c.user_id) ?? 0) + 1);
    }
    return map;
  }, [checkins]);

  const locationMap = useMemo(() => {
    const map = new Map<string, LocationRow>();
    for (const l of locations ?? []) {
      map.set(l.user_id, l);
    }
    return map;
  }, [locations]);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase().trim();
    return members.filter((m) => m.display_name.toLowerCase().includes(q));
  }, [members, search]);

  async function handleCopyCode() {
    const ok = await copyText(trip.invite_code);
    if (ok) toast.success(t("common.copied"));
    else toast.error(t("common.copyFailed"));
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg px-4 pb-6 pt-4">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-bold text-foreground">{t("members.title")}</h1>
            <span className="text-sm text-muted-foreground">
              {t("members.memberCount", { count: members.length })}
            </span>
          </div>

          {/* Invite code card */}
          <div
            className="mb-5 rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("members.inviteCode")}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-primary">
                  {trip.invite_code}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("members.inviteDesc")}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25 active:scale-95"
                aria-label={t("common.copy")}
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("members.searchPlaceholder")}
              className="h-11 w-full rounded-xl border border-border/60 bg-card/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            />
          </div>

          {/* Member list */}
          <ul className="space-y-2">
            {filteredMembers.map((m) => {
              const hue = hashHue(m.user_id);
              const initial = m.display_name.trim().charAt(0).toUpperCase() || "?";
              const isCreator = m.user_id === trip.created_by;
              const isMe = m.user_id === user.id;
              const count = checkinCount.get(m.user_id) ?? 0;
              const loc = locationMap.get(m.user_id);
              const sharing = loc?.sharing_enabled ?? false;

              return (
                <li
                  key={m.user_id}
                  className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-3 backdrop-blur transition-colors hover:bg-card/80"
                >
                  {/* Avatar */}
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full"
                    style={{ boxShadow: `0 0 0 2px hsl(${hue} 75% 55%)` }}
                  >
                    {m.avatar_url ? (
                      <CachedImage
                        value={m.avatar_url}
                        bucket="avatars"
                        alt={m.display_name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span
                        className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
                        style={{ background: `hsl(${hue} 65% 45%)` }}
                      >
                        {initial}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {m.display_name || t("common.traveler")}
                      </span>
                      {isMe && (
                        <span className="text-xs text-muted-foreground">
                          {t("members.you")}
                        </span>
                      )}
                      {isCreator && (
                        <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {t("members.joinedAt")}{" "}
                        {format(new Date(m.joined_at), "yyyy-MM-dd")}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Camera className="h-3 w-3" />
                        {count} {t("members.checkins")}
                      </span>
                    </div>
                  </div>

                  {/* Location status badge */}
                  <div className="shrink-0">
                    {sharing ? (
                      <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-primary">
                        <MapPin className="h-3 w-3" />
                        {t("members.sharing")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {t("members.notSharing")}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {filteredMembers.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
              <Users className="h-9 w-9 text-primary/70" />
              <div className="text-sm">{t("members.noMembers")}</div>
            </div>
          )}

          {/* Creator label */}
          {members.some((m) => m.user_id === trip.created_by) && (
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Crown className="h-3 w-3 text-amber-400" />
              {t("members.tripCreator")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
