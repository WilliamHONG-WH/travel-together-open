import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, Languages } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useI18n, useT } from "@/i18n";
import { ThemeToggle } from "@/theme/theme-toggle";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const t = useT();
  const { locale, toggleLocale } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.welcomeBack"));
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        toast.success(t("auth.accountCreated"));
        navigate({ to: "/" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      // 友好错误提示：针对常见注册错误给出明确指引
      if (msg.includes("rate limit") || msg.includes("over_request_rate_limit") || msg.includes("email rate limit")) {
        toast.error(t("auth.rateLimitError"));
        // 自动切换到登录标签，便于已注册用户直接登录
        setMode("signin");
      } else if (msg.includes("user already registered") || msg.includes("already been registered")) {
        toast.error(t("auth.userExistsError"));
        setMode("signin");
      } else if (msg.includes("invalid email") || msg.includes("email_address_invalid")) {
        toast.error(t("auth.invalidEmailError"));
      } else {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-10">
      {/* 主题切换胶囊按钮 — 顶部左侧（与右侧语言按钮形成左右对称） */}
      <ThemeToggle className="absolute top-[calc(env(safe-area-inset-top,12px)+12px)] left-6 z-50" />

      {/* 语言切换胶囊按钮 — 顶部右侧，样式与 ThemeToggle 一致 */}
      <button
        onClick={toggleLocale}
        className="absolute top-[calc(env(safe-area-inset-top,12px)+12px)] right-6 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md transition-all hover:text-foreground"
      >
        <Languages className="h-3.5 w-3.5 text-brand" />
        <span className="font-medium">{locale === "en" ? "中" : "EN"}</span>
      </button>

      <BrandMark size="md" subtitle={t("auth.subtitle")} className="mb-6" />

      <div
        className="mt-8 w-full max-w-[375px] rounded-2xl border border-border bg-card/82 p-5 backdrop-blur-md"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-lg py-2 text-xs font-semibold transition-all",
                mode === m
                  ? "bg-brand text-brand-foreground shadow-md"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {m === "signin" ? t("auth.signIn") : t("auth.signUp")}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-semibold text-foreground">
                {t("auth.displayName")}
              </Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("auth.displayNamePlaceholder")}
                autoComplete="nickname"
                className="h-8 rounded-lg border-border bg-input text-xs text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-brand/60 focus-visible:ring-1 focus-visible:ring-brand/50"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-semibold text-foreground">
              {t("auth.email")}
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
              className="h-8 rounded-lg border-border bg-input text-xs text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-brand/60 focus-visible:ring-1 focus-visible:ring-brand/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-semibold text-foreground">
              {t("auth.password")}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="h-8 rounded-lg border-border bg-input pr-10 text-xs text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-brand/60 focus-visible:ring-1 focus-visible:ring-brand/50"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 w-full bg-brand text-sm font-semibold text-brand-foreground transition-all hover:bg-brand/90 disabled:opacity-60"
            style={{ boxShadow: "var(--shadow-brand)" }}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : mode === "signin" ? (
              t("auth.signIn")
            ) : (
              t("auth.createAccount")
            )}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">{t("auth.noConfirmation")}</p>
    </div>
  );
}
