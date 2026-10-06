import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StampCollection } from "@/components/stamps/StampCollection";
import { userStampsQueryOptions } from "@/lib/user-stamps";
import { tripMembersQueryOptions } from "@/lib/trip-members";

export const Route = createFileRoute("/_authenticated/trips/$tripId/footprints")({
  beforeLoad: async ({ params }) => {
    const { data, error } = await supabase
      .from("trips")
      .select("id, name, invite_code, created_by")
      .eq("id", params.tripId)
      .maybeSingle();
    if (error || !data) throw redirect({ to: "/" });
    return { trip: data };
  },
  // loader 预取：进入足迹 Tab 前确保数据已在缓存中，实现秒开
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(userStampsQueryOptions(params.tripId));
    context.queryClient.ensureQueryData(tripMembersQueryOptions(params.tripId));
  },
  component: FootprintsPage,
});

function FootprintsPage() {
  const { tripId } = Route.useParams();
  const { trip } = Route.useRouteContext();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto pt-[calc(env(safe-area-inset-top,12px)+52px)]">
      <div className="mx-auto max-w-lg px-1 pb-10 pt-3">
        <StampCollection tripId={tripId} tripName={trip.name} />
      </div>
    </div>
  );
}
