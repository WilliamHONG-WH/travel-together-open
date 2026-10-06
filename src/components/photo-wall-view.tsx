import { ImageOff } from "lucide-react";
import { SignedImage, CachedImage } from "@/components/signed-image";
import { hashHue } from "@/lib/member-filter";
import type { Checkin } from "@/lib/checkins";
import type { TripMember } from "@/lib/trip-members";
import { useT } from "@/i18n";

export function PhotoWallView({
  checkins,
  memberById,
  onOpen,
}: {
  checkins: Checkin[];
  memberById: Map<string, TripMember>;
  onOpen: (index: number) => void;
}) {
  const t = useT();
  const photos = checkins.filter((c) => !!c.image_url);

  if (photos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <ImageOff className="h-9 w-9 text-primary/70" />
        <div className="text-sm">{t("photo.noPhotos")}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-1.5 pb-8 pt-3">
      <div className="grid grid-cols-3 gap-1">
        {photos.map((c, i) => {
          const member = memberById.get(c.user_id);
          const name = member?.display_name ?? t("common.teammate");
          const hue = hashHue(c.user_id);
          const initial = name.trim().charAt(0).toUpperCase() || "?";
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(i)}
              className="group relative aspect-square overflow-hidden rounded-md bg-muted"
              aria-label={t("photo.openPhoto", { title: c.title })}
            >
              <SignedImage
                path={c.image_url}
                alt={c.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="absolute bottom-1 right-1">
                {member?.avatar_url ? (
                  <CachedImage
                    value={member.avatar_url}
                    bucket="avatars"
                    alt={name}
                    referrerPolicy="no-referrer"
                    className="h-6 w-6 rounded-full object-cover ring-2 ring-background"
                  />
                ) : (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background"
                    style={{ background: `hsl(${hue} 65% 45%)` }}
                  >
                    {initial}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
