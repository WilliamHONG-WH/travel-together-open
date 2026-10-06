import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { hashHue, useMemberFilter } from "@/lib/member-filter";
import { CachedImage } from "@/components/signed-image";
import { useT } from "@/i18n";

export function MemberFilterSheet({
  tripId,
  filter,
}: {
  tripId: string;
  filter: ReturnType<typeof useMemberFilter>;
}) {
  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));
  const t = useT();
  const hiddenCount = useMemo(
    () => members.filter((m) => filter.hiddenIds.has(m.user_id)).length,
    [members, filter.hiddenIds],
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("filter.title")}
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/70 text-foreground shadow-md backdrop-blur-xl transition-colors hover:bg-background/90 active:scale-95"
        >
          <Filter className="h-5 w-5" />
          {hiddenCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {hiddenCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[70vh] rounded-t-3xl border-border/60 bg-card/95 backdrop-blur-xl"
      >
        <SheetHeader className="text-left">
          <SheetTitle>{t("filter.title")}</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={filter.selectAll}>
            {t("filter.selectAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={filter.clear}>
            {t("filter.clear")}
          </Button>
        </div>

        <ul className="mt-4 space-y-1 overflow-y-auto pb-6">
          {members.map((m) => {
            const checked = !filter.hiddenIds.has(m.user_id);
            const hue = hashHue(m.user_id);
            const initial = m.display_name.trim().charAt(0).toUpperCase() || "?";
            return (
              <li key={m.user_id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => filter.toggle(m.user_id)}
                  />
                  <div
                    className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full"
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
                        className="flex h-full w-full items-center justify-center text-xs font-semibold text-white"
                        style={{ background: `hsl(${hue} 65% 45%)` }}
                      >
                        {initial}
                      </span>
                    )}
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {m.display_name}
                  </span>
                </label>
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">
              {t("filter.noMembers")}
            </li>
          )}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
