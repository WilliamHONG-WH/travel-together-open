import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TripMember = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  joined_at: string;
};

export function tripMembersQueryOptions(tripId: string) {
  return queryOptions({
    queryKey: ["trip-members", tripId],
    queryFn: async (): Promise<TripMember[]> => {
      const { data: members, error } = await supabase
        .from("trip_members")
        .select("user_id, joined_at")
        .eq("trip_id", tripId);
      if (error) throw error;
      const rows = members ?? [];
      if (rows.length === 0) return [];
      const ids = rows.map((m) => m.user_id);
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", ids);
      if (pErr) throw pErr;
      const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
      return rows.map((m) => {
        const p = profMap.get(m.user_id);
        return {
          user_id: m.user_id,
          display_name: p?.display_name ?? "",
          avatar_url: p?.avatar_url ?? null,
          joined_at: m.joined_at,
        };
      });
    },
  });
}
