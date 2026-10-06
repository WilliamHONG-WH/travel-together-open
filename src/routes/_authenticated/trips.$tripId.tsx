import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { TripBottomNav } from "@/components/trip-bottom-nav";

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  beforeLoad: async ({ params }) => {
    const { data, error } = await supabase
      .from("trips")
      .select("id, name, invite_code, created_by")
      .eq("id", params.tripId)
      .maybeSingle();
    if (error || !data) throw redirect({ to: "/" });
    return { trip: data };
  },
  component: TripLayout,
});

function TripLayout() {
  const { trip } = Route.useRouteContext();
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* 左上角返回箭头已移除 — 改由【设置】页面右上角的 HOME 按钮统一返回主界面 */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>

      <TripBottomNav tripId={trip.id} />
    </div>
  );
}
