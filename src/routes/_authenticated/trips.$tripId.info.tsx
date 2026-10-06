import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TripInfoModule } from "@/components/trip-info-module";

export const Route = createFileRoute("/_authenticated/trips/$tripId/info")({
  beforeLoad: async ({ params }) => {
    const { data, error } = await supabase
      .from("trips")
      .select("id, name, invite_code, created_by")
      .eq("id", params.tripId)
      .maybeSingle();
    if (error || !data) throw redirect({ to: "/" });
    return { trip: data };
  },
  component: TripInfoPage,
});

function TripInfoPage() {
  const { tripId } = Route.useParams();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto pt-[calc(env(safe-area-inset-top,12px)+52px)]">
      <TripInfoModule tripId={tripId} currentUserId={userId} />
    </div>
  );
}
