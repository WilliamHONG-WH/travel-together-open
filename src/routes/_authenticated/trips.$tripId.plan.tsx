import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ListChecks, CalendarDays, UtensilsCrossed, BedDouble } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useT, useI18n } from "@/i18n";
import { ChecklistPanel, ItineraryPanel } from "@/components/trip-info-module";
import { TripFoodModule } from "@/components/trip-food-module";
import { HotelsPanel } from "@/components/hotels/HotelsPanel";

type PlanTab = "packing" | "itinerary" | "dining" | "hotels";

export const Route = createFileRoute("/_authenticated/trips/$tripId/plan")({
  beforeLoad: async ({ params }) => {
    const { data, error } = await supabase
      .from("trips")
      .select("id, name, invite_code, created_by")
      .eq("id", params.tripId)
      .maybeSingle();
    if (error || !data) throw redirect({ to: "/" });
    return { trip: data };
  },
  component: PlanPage,
});

function PlanPage() {
  const { tripId } = Route.useParams();
  const { trip } = Route.useRouteContext();
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [activeTab, setActiveTab] = useState<PlanTab>("packing");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const tabs = [
    { key: "packing" as const, icon: ListChecks, label: isEn ? "Packing" : "物品清单" },
    { key: "itinerary" as const, icon: CalendarDays, label: isEn ? "Itinerary" : "行程规划" },
    { key: "dining" as const, icon: UtensilsCrossed, label: isEn ? "Dining" : "美食规划" },
    { key: "hotels" as const, icon: BedDouble, label: isEn ? "Hotels" : "酒店" },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto pt-[calc(env(safe-area-inset-top,12px)+52px)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto max-w-lg px-4 pb-28 pt-3">
        <div className="mb-5 flex w-full items-center gap-1.5 rounded-2xl border border-border bg-card p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-all duration-300",
                activeTab === tab.key
                  ? "border border-brand/50 bg-brand/15 text-brand"
                  : "border border-transparent bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {activeTab === "packing" && (
          <ChecklistPanel tripId={tripId} currentUserId={currentUserId} tripName={trip.name} />
        )}
        {activeTab === "itinerary" && (
          <ItineraryPanel tripId={tripId} currentUserId={currentUserId} />
        )}
        {activeTab === "dining" && (
          <TripFoodModule tripId={tripId} />
        )}
        {activeTab === "hotels" && (
          <HotelsPanel tripId={tripId} />
        )}
      </div>
    </div>
  );
}
