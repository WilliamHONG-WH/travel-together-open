import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Users, LogOut, Loader2, ArrowRight, Copy, Languages } from "lucide-react";
import { copyText } from "@/lib/copy-to-clipboard";

import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, useT } from "@/i18n";
import { ThemeToggle } from "@/theme/theme-toggle";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

type Mode = "menu" | "create" | "join";

function HomePage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locale, toggleLocale } = useI18n();
  const t = useT();
  const [mode, setMode] = useState<Mode>("menu");
  const [tripName, setTripName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: profile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: trips } = useQuery({
    queryKey: ["my-trips", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_members")
        .select("trip_id, joined_at, trips(id, name, invite_code, created_at)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      return (data || []).filter((tm) => {
        const id = tm.trips?.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
  });

  // profile 加载中或一笔画未结束时显示 "...!"，加载完成但无 display_name 时回退到"旅行者/Traveler"
  // 绝不暴露邮箱前缀，避免视觉闪烁
  const firstName = isLoadingProfile
    ? "...!"
    : (profile?.display_name || t("common.traveler"));

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tripName.trim() || busy) return;
    setBusy(true);
    try {
      // invite_code is auto-filled by a BEFORE INSERT trigger; sending empty string satisfies NOT NULL.
      const { data, error } = await supabase
        .from("trips")
        .insert({ name: tripName.trim(), created_by: user.id, invite_code: "" })
        .select("id, name, invite_code, created_by, created_at")
        .single();
      if (error) throw error;
      toast.success(t("home.tripCreated", { code: data.invite_code }));
      setTripName("");
      // Optimistically append the new trip to the cache so the card renders instantly,
      // then invalidate in the background to stay in sync with the DB trigger that inserts trip_members.
      queryClient.setQueryData(
        ["my-trips", user.id],
        (oldData: typeof trips | undefined) => [
          {
            trip_id: data.id,
            joined_at: new Date().toISOString(),
            trips: {
              id: data.id,
              name: data.name,
              invite_code: data.invite_code,
              created_at: data.created_at,
            },
          },
          ...(oldData ?? []),
        ],
      );
      setMode("menu");
      void queryClient.invalidateQueries({ queryKey: ["my-trips"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("home.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    // Mobile keyboards often add trailing spaces or lowercase letters — normalize aggressively.
    const sanitizedCode = inviteCode.replace(/\s+/g, "").toUpperCase();
    if (!sanitizedCode || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("join_trip_by_code", {
        _invite_code: sanitizedCode,
        _user_id: user.id,
      });
      if (error) {
        console.error("[join_trip_by_code]", error);
        const msg = error.message || "";
        if (msg.includes("Invite code not found")) {
          toast.error(t("home.codeNotFound", { code: sanitizedCode }));
        } else if (msg.toLowerCase().includes("permission")) {
          toast.error(t("home.permissionDenied", { msg }));
        } else {
          toast.error(t("home.joinFailed", { msg }));
        }
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        toast.error(t("home.joinFailedNoData"));
        return;
      }
      // 兼容新版无歧义返回值：优先 out_trip_id，回退到 trip_id
      const tripId = row.out_trip_id || row.trip_id;
      if (!tripId) {
        toast.error(t("home.joinFailedNoData"));
        return;
      }
      const tripName = row.out_trip_name || row.trip_name;
      toast.success(
        row.already_member
          ? t("home.alreadyMember", { name: tripName || sanitizedCode })
          : t("home.joined", { name: tripName || sanitizedCode }),
      );
      setInviteCode("");
      // Invalidate 后台刷新行程列表，用户返回 Home 时即可看到新卡片
      void queryClient.invalidateQueries({ queryKey: ["my-trips"] });
      // 成功跳转至行程页面
      navigate({ to: "/trips/$tripId", params: { tripId } });
    } catch (err) {
      console.error("[handleJoin]", err);
      toast.error(err instanceof Error ? err.message : t("home.joinFailedNoData"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10 relative">
      {/* 顶部右侧按钮组：主题切换（左）+ 语言切换（右） */}
      <div className="fixed top-[calc(env(safe-area-inset-top,12px)+12px)] right-6 z-50 flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={toggleLocale}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md transition-all hover:text-foreground"
        >
          <Languages className="h-3.5 w-3.5 text-brand" />
          <span className="font-medium">{locale === "en" ? "中" : "EN"}</span>
        </button>
      </div>

      <BrandMark
        size="lg"
        subtitle={!isLoadingProfile ? t("home.welcome", { name: firstName }) : undefined}
        className="mb-8"
      />

      <div className="w-full max-w-md flex-1 space-y-4">
        {mode === "menu" && (
          <>
            {trips && trips.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("home.yourTrips")}
                </h2>
                <ul className="space-y-2">
                  {trips.map((tm) => {
                    const trip = tm.trips;
                    if (!trip) return null;
                    return (
                      <li key={trip.id}>
                        <Link
                          to="/trips/$tripId"
                          params={{ tripId: trip.id }}
                          className="group flex w-full items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-left transition-colors hover:bg-card"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-foreground">{trip.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span>{t("home.code")} {trip.invite_code}</span>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const ok = await copyText(trip.invite_code);
                                  if (ok) toast.success(t("common.copied"));
                                  else toast.error(t("common.copyFailed"));
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                                aria-label={t("common.copy")}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <button
              onClick={() => setMode("create")}
              className="group flex w-full flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card/70 py-8 transition-all hover:border-brand/60 hover:bg-card"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <Plus
                className="h-8 w-8 text-brand transition-transform group-hover:scale-110"
                strokeWidth={2.5}
              />
              <span className="text-lg font-semibold text-foreground">
                {t("home.createTrip")}
              </span>
            </button>
            <button
              onClick={() => setMode("join")}
              className="group flex w-full flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card/70 py-8 transition-all hover:border-brand/60 hover:bg-card"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <Users
                className="h-8 w-8 text-brand transition-transform group-hover:scale-110"
                strokeWidth={2.5}
              />
              <span className="text-lg font-semibold text-foreground">
                {t("home.joinTrip")}
              </span>
            </button>
          </>
        )}

        {mode === "create" && (
          <form onSubmit={handleCreate} className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">{t("home.createTitle")}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="tripName" className="sr-only">
                {t("settings.tripName")}
              </Label>
              <Input
                id="tripName"
                autoFocus
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
                placeholder={t("home.tripNamePlaceholder")}
                className="h-14 text-base border-brand/60 focus-visible:ring-brand"
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !tripName.trim()}
              className="h-10 w-full bg-brand text-sm font-semibold text-brand-foreground transition-all hover:bg-brand/90 disabled:opacity-60"
              style={{ boxShadow: "var(--shadow-brand)" }}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("home.createBtn")}
            </Button>
            <button
              type="button"
              onClick={() => setMode("menu")}
              className="mx-auto block text-sm text-muted-foreground hover:text-foreground"
            >
              {t("common.back")}
            </button>
          </form>
        )}

        {mode === "join" && (
          <form onSubmit={handleJoin} className="space-y-4">
            <h2 className="text-lg font-bold text-foreground">{t("home.joinTitle")}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="code" className="sr-only">
                {t("settings.inviteCode")}
              </Label>
              <Input
                id="code"
                autoFocus
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder={t("home.inviteCodePlaceholder")}
                maxLength={8}
                className="h-14 border-brand/60 text-center font-sans font-medium text-xl uppercase tracking-[0.4em] placeholder:text-muted-foreground/70 focus-visible:ring-brand"
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !inviteCode.trim()}
              className="h-10 w-full bg-brand text-sm font-semibold text-brand-foreground transition-all hover:bg-brand/90 disabled:opacity-60"
              style={{ boxShadow: "var(--shadow-brand)" }}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("home.joinBtn")}
            </Button>
            <button
              type="button"
              onClick={() => setMode("menu")}
              className="mx-auto block text-sm text-muted-foreground hover:text-foreground"
            >
              {t("common.back")}
            </button>
          </form>
        )}
      </div>

      <button
        onClick={handleSignOut}
        className="mt-10 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        {t("home.signOut")}
      </button>
    </div>
  );
}
