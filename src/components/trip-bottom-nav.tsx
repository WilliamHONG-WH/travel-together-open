import { Link } from "@tanstack/react-router";
import { Map, MessageCircle, Settings, Info, LayoutGrid, Footprints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { useChatUnread } from "@/lib/chat-unread";

type Tab = {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  exact?: boolean;
};

const tabs: Tab[] = [
  { to: "/trips/$tripId", labelKey: "nav.map", icon: Map, exact: true },
  { to: "/trips/$tripId/plan", labelKey: "nav.plan", icon: LayoutGrid },
  { to: "/trips/$tripId/footprints", labelKey: "nav.footprints", icon: Footprints },
  { to: "/trips/$tripId/info", labelKey: "nav.info", icon: Info },
  { to: "/trips/$tripId/chat", labelKey: "nav.chat", icon: MessageCircle },
  { to: "/trips/$tripId/settings", labelKey: "nav.settings", icon: Settings },
];

export function TripBottomNav({ tripId }: { tripId: string }) {
  const t = useT();
  const { unreadCount } = useChatUnread(tripId);
  return (
    <nav
      className="relative z-[1000] border-t border-border bg-card/85 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
        {tabs.map(({ to, labelKey, icon: Icon, exact }) => {
          const label = t(labelKey);
          return (
          <li key={to} className="flex-1">
            <Link
              to={to}
              params={{ tripId }}
              activeOptions={{ exact: !!exact }}
              className="group flex flex-col items-center gap-1 py-2.5 text-muted-foreground transition-colors"
              activeProps={{ className: "!text-brand drop-shadow-[0_0_6px_rgba(13,148,136,0.45)]" }}
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-transform",
                        isActive && "scale-110",
                      )}
                      strokeWidth={2.2}
                    />
                    {to === "/trips/$tripId/chat" && unreadCount > 0 && !isActive && (
                      <span className="absolute -top-1.5 -right-2.5 bg-rose-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center animate-pulse shadow-sm">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-medium tracking-wide">{label}</span>
                </>
              )}
            </Link>
          </li>
          );
        })}
      </ul>
    </nav>
  );
}
