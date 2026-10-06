import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Loader2,
  LogOut,
  MapPin,
  Bell,
  Globe,
  User as UserIcon,
  Camera,
  AlertTriangle,
  Save,
  Check,
  Trash2,
  Undo2,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import { useT, useI18n, type Locale } from "@/i18n";
import { copyText } from "@/lib/copy-to-clipboard";
import { compressImageToFile } from "@/lib/compress-image";
import { invalidateImage } from "@/lib/image-cache";
import { CachedImage } from "@/components/signed-image";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeSettingsCard } from "@/theme/theme-toggle";
import { TripPackageCard } from "@/components/trip-package-card";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/trips/$tripId/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { tripId } = Route.useParams();
  const { trip, user } = Route.useRouteContext();
  const t = useT();
  const { locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    pushEnabled,
    pushSupported,
    checking,
    toggling,
    togglePush,
  } = usePushSubscription(tripId, user.id);

  const [tripName, setTripName] = useState(trip.name);
  const [displayName, setDisplayName] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自毁倒计时状态：5 秒延迟删除机制，给用户一颗"后悔药"
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const [isShredding, setIsShredding] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dissolveTriggeredRef = useRef(false);

  // Fetch current user profile
  const { data: profile } = useQuery({
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

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  // 当前行程成员列表：用于显示名称"防重名"校验（与右上角队员栏同源数据）
  const { data: tripMembers } = useQuery(tripMembersQueryOptions(tripId));

  // Avatar upload handler — 上传前强制客户端压缩（≤1280px / ≤400KB / JPEG）
  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const compressed = await compressImageToFile(file);
      const filePath = `${user.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(filePath, compressed, {
          contentType: "image/jpeg",
          cacheControl: "3600000",
          upsert: true,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
      // avatars 桶同路径 upsert 覆盖 → 本地 IndexedDB 缓存必须失效，否则一直显示旧头像
      invalidateImage("avatars", filePath);
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
      queryClient.invalidateQueries({ queryKey: ["trip-members", tripId] });
      toast.success(locale === "zh" ? "头像已更新" : "Avatar updated");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("bucket") || msg.toLowerCase().includes("not found")) {
        toast.error(
          locale === "zh"
            ? "请在 Supabase 后台创建名为 'avatars' 的私密存储桶(Bucket)以激活此功能"
            : "Please create a private bucket named 'avatars' in Supabase dashboard to enable this feature"
        );
      } else {
        toast.error(locale === "zh" ? "头像上传失败" : "Avatar upload failed");
      }
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Fetch current user's location sharing status
  const { data: myLocation } = useQuery({
    queryKey: ["my-location-status", tripId, user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_locations")
        .select("sharing_enabled")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Save trip name
  const saveTripName = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("trips")
        .update({ name: tripName.trim() })
        .eq("id", tripId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("settings.tripSaved"));
      queryClient.invalidateQueries({ queryKey: ["my-trips"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  // Save display name — 保存前做"防重名"校验
  const saveProfile = useMutation({
    mutationFn: async () => {
      const newName = displayName.trim();
      // 防重名拦截：与当前行程内其他成员重名（大小写不敏感，排除自己）则阻止保存
      const isDuplicate = (tripMembers ?? []).some(
        (m) =>
          m.user_id !== user.id &&
          m.display_name?.trim().toLowerCase() === newName.toLowerCase()
      );
      if (isDuplicate) {
        throw new Error(
          locale === "zh"
            ? "该名称已被行程内其他成员使用，请更换一个昵称"
            : "This name is already used by another member in this trip. Please pick a different one."
        );
      }
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: newName })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("settings.profileSaved"));
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
      queryClient.invalidateQueries({ queryKey: ["trip-members", tripId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  // Toggle location sharing
  const toggleLocation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("user_locations")
        .upsert(
          {
            trip_id: tripId,
            user_id: user.id,
            sharing_enabled: enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,trip_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["my-location-status", tripId, user.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["user-locations", tripId],
      });
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  // Leave trip
  const leaveTrip = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("trip_members")
        .delete()
        .eq("trip_id", tripId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("settings.leftTrip"));
      queryClient.clear();
      navigate({ to: "/", replace: true });
    },
    onError: (e: any) => toast.error(e?.message ?? t("settings.leaveTripFailed")),
  });

  // Delete trip (creator only)
  const deleteTrip = useMutation({
    mutationFn: async () => {
      // 删除行程前，先清理 Storage 中该 trip 的所有打卡图片（best-effort）
      // 文件路径格式：{tripId}/{userId}/{uuid}.jpg
      try {
        const { data: files } = await supabase.storage
          .from("checkin-images")
          .list(tripId, { limit: 1000 });
        if (files && files.length > 0) {
          // 逐个文件路径构建并批量删除
          const paths = files.map((f) => `${tripId}/${f.name}`);
          await supabase.storage.from("checkin-images").remove(paths);
        }
      } catch (storageErr) {
        console.warn("[DeleteTrip] Storage 清理失败 (非关键):", storageErr);
      }

      const { error } = await supabase.from("trips").delete().eq("id", tripId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("settings.tripDeleted"));
      queryClient.clear();
      navigate({ to: "/", replace: true });
    },
    onError: (e: any) => {
      setIsShredding(false);
      toast.error(e?.message ?? t("settings.deleteTripFailed"));
    },
  });

  // 组件卸载时清除倒计时定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, []);

  // 启动 5 秒自毁倒计时
  function startCountdown() {
    dissolveTriggeredRef.current = false;
    setCountdownSeconds(5);
    setIsCountingDown(true);
    countdownTimerRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          // 倒计时归零，清除定时器并执行物理删除
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          if (!dissolveTriggeredRef.current) {
            dissolveTriggeredRef.current = true;
            setIsCountingDown(false);
            setIsShredding(true);
            deleteTrip.mutate();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // 撤销解散
  function undoCountdown() {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setIsCountingDown(false);
    toast.success(t("settings.dissolveCancelled"));
  }

  // Sign out
  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function handleCopyCode() {
    const ok = await copyText(trip.invite_code);
    if (ok) toast.success(t("common.copied"));
    else toast.error(t("common.copyFailed"));
  }

  const sharingEnabled = myLocation?.sharing_enabled ?? false;
  const isCreator = user.id === trip.created_by;
  const languages: { value: Locale; label: string }[] = [
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex-1 overflow-y-auto pt-[calc(env(safe-area-inset-top,12px)+52px)]">
        <div className="mx-auto max-w-lg space-y-6 px-4 pb-6 pt-3">
          {/* Trip Settings */}
          <section
            className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4 text-brand" />
                {t("settings.tripSettings")}
              </h2>
              {/* HOME 按钮：替代各模块左上角返回箭头，统一回到主界面 (Trip List / 首页 `/`) */}
              <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                aria-label={t("common.home")}
                title={t("common.home")}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-200 active:scale-95 dark:bg-slate-800/50 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Home className="h-3.5 w-3.5" />
                {t("common.home")}
              </button>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tripName" className="text-xs text-muted-foreground">
                  {t("settings.tripName")}
                </Label>
                <Input
                  id="tripName"
                  value={tripName}
                  onChange={(e) => setTripName(e.target.value)}
                  placeholder={t("settings.tripNamePlaceholder")}
                  className="h-11"
                />
              </div>
              <Button
                onClick={() => saveTripName.mutate()}
                disabled={saveTripName.isPending || !tripName.trim() || tripName.trim() === trip.name}
                className="w-full bg-brand text-brand-foreground font-medium hover:bg-brand/90 shadow-[0_0_15px_rgba(13,148,136,0.3)] disabled:bg-brand/40 disabled:shadow-none"
                size="sm"
              >
                {saveTripName.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                {t("settings.saveTrip")}
              </Button>
            </div>

            {/* Invite code */}
            <div className="mt-4 rounded-xl border border-border/40 bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.inviteCode")}
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-bold tracking-[0.2em] text-brand">
                    {trip.invite_code}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("settings.inviteCodeDesc")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand transition-colors hover:bg-brand/25 active:scale-95"
                  aria-label={t("common.copy")}
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          {/* Trip Package & Backup — 旅行数据包（导入与导出） */}
          <TripPackageCard tripId={tripId} tripName={trip.name} />

          {/* Location Sharing + Push Notifications：左右并排紧凑卡片 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section
              className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4 text-brand" />
                {t("settings.locationSettings")}
              </h2>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {t("settings.shareLocation")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.shareLocationDesc")}
                  </div>
                </div>
                <Switch
                  checked={sharingEnabled}
                  onCheckedChange={(v) => toggleLocation.mutate(v)}
                  disabled={toggleLocation.isPending}
                />
              </div>
            </section>

            <section
              className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bell className="h-4 w-4 text-brand" />
                {t("settings.notifications")}
              </h2>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {t("settings.notifications")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.notificationsDesc")}
                  </div>
                </div>
                <Switch
                  checked={pushEnabled}
                  onCheckedChange={togglePush}
                  disabled={!pushSupported || checking || toggling}
                />
              </div>
            </section>
          </div>

          {/* Language */}
          <section
            className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Globe className="h-4 w-4 text-brand" />
              {t("settings.language")}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("settings.languageDesc")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {languages.map((lang) => (
                <button
                  key={lang.value}
                  type="button"
                  onClick={() => setLocale(lang.value)}
                  className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all ${
                    locale === lang.value
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {locale === lang.value && <Check className="h-4 w-4" />}
                  {lang.label}
                </button>
              ))}
            </div>
          </section>

          {/* Theme — 与语言卡片同级，提供浅色 / 深色 / 跟随系统三选项 */}
          <ThemeSettingsCard />

          {/* Profile */}
          <section
            className="rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <UserIcon className="h-4 w-4 text-brand" />
              {t("settings.profile")}
            </h2>
            <div className="space-y-3">
              {/* Avatar */}
              <div className="flex flex-col items-center">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="group relative h-20 w-20 overflow-hidden rounded-full transition-all"
                  style={{
                    background: profile?.avatar_url
                      ? undefined
                      : "linear-gradient(135deg, var(--brand) 0%, #08B4C4 100%)",
                    boxShadow: "var(--shadow-brand)",
                  }}
                >
                  {avatarUploading ? (
                    <span className="flex h-full w-full items-center justify-center bg-black/50">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </span>
                  ) : profile?.avatar_url ? (
                    <CachedImage
                      value={profile.avatar_url}
                      bucket="avatars"
                      alt="avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
                      {(displayName || "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  {!avatarUploading && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera className="h-5 w-5 text-white" />
                      <span className="text-xs font-medium text-white">
                        {locale === "zh" ? "更换" : "Change"}
                      </span>
                    </span>
                  )}
                </button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="displayName" className="text-xs text-muted-foreground">
                  {t("settings.displayName")}
                </Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("settings.displayNamePlaceholder")}
                  className="h-11"
                />
              </div>
              <Button
                onClick={() => saveProfile.mutate()}
                disabled={
                  saveProfile.isPending ||
                  !displayName.trim() ||
                  displayName.trim() === profile?.display_name
                }
                className="w-full bg-brand text-brand-foreground font-medium hover:bg-brand/90 shadow-[0_0_15px_rgba(13,148,136,0.3)] disabled:bg-brand/40 disabled:shadow-none"
                size="sm"
              >
                {saveProfile.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                {t("settings.saveProfile")}
              </Button>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t("settings.dangerZone")}
            </h2>
            <div className="space-y-3">
              {/* Delete trip (creator only) */}
              {isCreator && (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {t("settings.deleteTrip")}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("settings.deleteTripDesc")}
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("settings.deleteTrip")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.deleteTrip")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.deleteTripConfirm")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => startCountdown()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t("settings.deleteTripBtn")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              {/* Leave trip (non-creator only) */}
              {!isCreator && (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {t("settings.leaveTrip")}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("settings.leaveTripDesc")}
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        {t("settings.leaveTrip")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.leaveTrip")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.leaveTripConfirm", { name: trip.name })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => leaveTrip.mutate()}
                          disabled={leaveTrip.isPending}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {leaveTrip.isPending && (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          )}
                          {t("settings.leaveTripBtn")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              {/* Sign out */}
              <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {t("settings.signOut")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.signOutDesc")}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  <LogOut className="mr-1.5 h-4 w-4" />
                  {t("settings.signOut")}
                </Button>
              </div>
            </div>
          </section>

          {/* About */}
          <div className="flex flex-col items-center gap-1 pt-2 text-center">
            <div className="text-xs text-muted-foreground">{t("settings.about")}</div>
            <div className="text-xs text-muted-foreground">
              {t("settings.version")} 1.0.0
            </div>
          </div>
        </div>
      </div>

      {/* 自毁倒计时全屏蒙层 — 暗黑科技风 */}
      {(isCountingDown || isShredding) && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
          {isCountingDown ? (
            <>
              {/* 红色霓虹倒计时圆环 */}
              <div className="relative flex h-40 w-40 items-center justify-center">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    boxShadow:
                      "0 0 60px rgba(239, 68, 68, 0.6), 0 0 120px rgba(239, 68, 68, 0.3)",
                    border: "3px solid rgba(239, 68, 68, 0.8)",
                    background:
                      "radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)",
                  }}
                />
                <span
                  className="relative text-7xl font-bold tabular-nums"
                  style={{
                    color: "#ff4444",
                    textShadow: "0 0 20px rgba(239, 68, 68, 0.8)",
                  }}
                >
                  {countdownSeconds}
                </span>
              </div>
              {/* 双语警告文字 */}
              <p className="mt-8 max-w-xs text-center text-sm leading-relaxed text-red-300/90">
                {t("settings.selfDestructWarning", { sec: countdownSeconds })}
              </p>
              {/* 撤销按钮 — 青蓝发光边框 */}
              <button
                type="button"
                onClick={undoCountdown}
                className="mt-8 flex items-center gap-2 rounded-full border-2 px-8 py-3 text-sm font-semibold transition-all hover:scale-105 active:scale-95"
                style={{
                  borderColor: "#00F2FE",
                  color: "#00F2FE",
                  background: "rgba(0, 242, 254, 0.1)",
                  boxShadow: "0 0 30px rgba(0, 242, 254, 0.5)",
                }}
              >
                <Undo2 className="h-4 w-4" />
                {t("settings.undoDissolve")}
              </button>
            </>
          ) : (
            // 粉碎进行中
            <div className="flex flex-col items-center gap-4">
              <Loader2
                className="h-12 w-12 animate-spin text-red-500"
                style={{ filter: "drop-shadow(0 0 8px rgba(239,68,68,0.6))" }}
              />
              <p className="text-sm font-medium text-red-300">
                {t("settings.shreddingData")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
