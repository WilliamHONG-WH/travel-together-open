import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { TripMap } from "@/components/trip-map";
import { checkinsQueryOptions } from "@/lib/checkins";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { tripLocationsQueryOptions } from "@/lib/user-locations";
import { useT } from "@/i18n";

const searchSchema = z.object({
  focus: z.string().optional(),
  // 百科详情「一键跳转地图定位」深链：值为 encyclopedia_items.id
  museum: z.string().optional(),
  // 酒店详情「一键跳转地图定位」深链：值为 hotels.id
  hotel: z.string().optional(),
  // 餐厅详情「一键跳转地图定位」深链：值为 trip_restaurants.id
  restaurant: z.string().optional(),
  // 足迹详情「地图定位按钮」深链：值为 user_stamps.id（用于高亮标记）
  locate: z.string().optional(),
  // 足迹定位目标坐标（字符串数字）+ 时间戳 t —— 地图就绪后 flyTo 精确坐标，
  // t 变化即重新触发（支持反复定位同一打卡点）
  targetLat: z.string().optional(),
  targetLng: z.string().optional(),
  t: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/trips/$tripId/")({
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(checkinsQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(tripMembersQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(tripLocationsQueryOptions(params.tripId));
  },
  component: TripMapPage,
  errorComponent: ({ error }) => (
    <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
      {(error as Error).message}
    </div>
  ),
  notFoundComponent: () => {
    const t = useT();
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("trip.notFound")}
      </div>
    );
  },
});

function TripMapPage() {
  const { tripId } = Route.useParams();
  const { focus, museum, hotel, restaurant, locate, targetLat, targetLng, t: locateT } = Route.useSearch();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="absolute inset-0">
      {mounted ? (
        <TripMap tripId={tripId} focusCheckinId={focus ?? null} focusMuseumId={museum ?? null} focusHotelId={hotel ?? null} focusRestaurantId={restaurant ?? null} locateCheckinId={locate ?? null} targetLat={targetLat ?? null} targetLng={targetLng ?? null} targetT={locateT ?? null} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
