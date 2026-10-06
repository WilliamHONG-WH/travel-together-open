import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { Loader2, Send, MapPin, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SignedImage } from "@/components/signed-image";
import { useT, useI18n } from "@/i18n";
import {
  messagesQueryOptions,
  recallMessage,
  sendTextMessage,
  type Message,
} from "@/lib/messages";
import { checkinsQueryOptions, type Checkin } from "@/lib/checkins";
import { tripMembersQueryOptions, type TripMember } from "@/lib/trip-members";
import { MemberAvatar } from "@/components/member-avatar";

const STICK_THRESHOLD_PX = 100;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function TripChat({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [userId, setUserId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 触屏设备（手机/平板）不做 Enter 直发，保留键盘原生换行体验
  const isTouchDevice =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(pointer: coarse)").matches;

  const { data: messages, isLoading: messagesLoading } = useQuery(messagesQueryOptions(tripId));

  // 首帧状态锁：messages 尚未到达（undefined）时强制显示加载态，绝不闪现空状态
  // 双保险：即使 TanStack Query 的 isLoading 短暂为 false 但 data 未到，也不渲染 Empty State
  const showLoading = messagesLoading || messages === undefined;
  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));
  const { data: checkins } = useSuspenseQuery(checkinsQueryOptions(tripId));

  const memberById = useMemo(() => {
    const m = new Map<string, TripMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  const checkinById = useMemo(() => {
    const m = new Map<string, Checkin>();
    for (const x of checkins) m.set(x.id, x);
    return m;
  }, [checkins]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Realtime new messages + recall updates
  useEffect(() => {
    const key = messagesQueryOptions(tripId).queryKey;
    const channel = supabase
      .channel(`messages:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          queryClient.setQueryData<Message[]>(key, (old) => {
            const list = old ?? [];
            if (list.some((m) => m.id === row.id)) return list;
            return [...list, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          // 撤回等更新：合并行数据，保留前端拼装的 profiles
          const row = payload.new as Message;
          queryClient.setQueryData<Message[]>(key, (old) =>
            (old ?? []).map((m) =>
              m.id === row.id ? { ...m, ...row, profiles: m.profiles } : m,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, queryClient]);

  // Realtime announcement: fetch latest + subscribe to changes
  useEffect(() => {
    if (!tripId) return;

    const fetchAnnouncement = async () => {
      const { data } = await (supabase as any)
        .from("trip_announcements")
        .select("content")
        .eq("trip_id", tripId)
        .maybeSingle();
      if (data) setAnnouncement(data.content || "");
    };
    fetchAnnouncement();

    const channel = (supabase as any)
      .channel(`chat-top-announcement-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_announcements",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload: any) => {
          if (payload.new) {
            setAnnouncement(payload.new.content || "");
          } else {
            setAnnouncement("");
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  // Track whether user is near bottom
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < STICK_THRESHOLD_PX;
  };

  // Auto-scroll on new messages when stuck to bottom (and on mount)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages?.length]);

  const send = useMutation({
    mutationFn: async (content: string) => {
      if (!userId) throw new Error(t("chat.notLoggedIn"));
      return sendTextMessage({ tripId, userId, content });
    },
    onSuccess: (row) => {
      const key = messagesQueryOptions(tripId).queryKey;
      queryClient.setQueryData<Message[]>(key, (old) => {
        const list = old ?? [];
        if (list.some((m) => m.id === row.id)) return list;
        return [...list, row];
      });
      setText("");
      stickToBottomRef.current = true;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });

      // Web Push：fire-and-forget 通知离线队友（本地 dev 未部署 api/ 时静默忽略）
      fetch("/api/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          senderId: userId,
          title: row.profiles?.display_name || "山海同行",
          body: row.content.slice(0, 100),
          url: `/trips/${tripId}/chat`,
        }),
      }).catch(() => {});
    },
    onError: (e: any) => toast.error(e?.message ?? t("chat.sendFailed")),
  });

  const handleSend = () => {
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(content);
  };

  // 撤回消息：乐观更新本地缓存，Realtime UPDATE 负责同步全团
  const recall = useMutation({
    mutationFn: (msg: Message) => recallMessage(msg.id),
    onMutate: (msg) => {
      const key = messagesQueryOptions(tripId).queryKey;
      queryClient.setQueryData<Message[]>(key, (old) =>
        (old ?? []).map((m) =>
          m.id === msg.id ? { ...m, is_recalled: true } : m,
        ),
      );
    },
    onError: (e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e ?? "");
      console.error("[recall] failed:", e);
      toast.error(`${t("chat.recallFailed")}: ${detail}`);
      queryClient.invalidateQueries({ queryKey: messagesQueryOptions(tripId).queryKey });
    },
  });

  // 重新编辑：撤回文本一键回填输入框，聚焦光标到末尾
  const handleReedit = (content: string) => {
    // 同步聚焦（移动端须在用户手势内触发键盘）
    textareaRef.current?.focus();
    setText(content); // 文字变化会触发下方高度自适应 useEffect
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  // 高度自适应：随内容撑高至 120px（约 4~5 行），超出后开启内部滚动；
  // 文字清空（发送成功）时 scrollHeight 归零，min-h-[40px] 兜底恢复单行
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // 电脑端：Enter 发送，Shift+Enter 换行；移动端保持键盘原生行为
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSend();
    }
  };

  const openCheckin = (checkinId: string) => {
    navigate({
      to: "/trips/$tripId",
      params: { tripId },
      search: { focus: checkinId },
    });
  };

  return (
    <div className="flex h-full flex-col bg-background pt-[calc(env(safe-area-inset-top,12px)+52px)]">
      {/* 独立通知栏：下移至 Header 下方 */}
      {announcement && announcement.trim() !== "" && (
        <div className="mx-4 mb-3">
          <div
            onClick={() => {
              navigate({ to: "/trips/$tripId/info", params: { tripId } });
            }}
            className="group flex cursor-pointer items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2 text-xs text-brand transition-all duration-200 hover:bg-brand/20"
          >
            <Megaphone className="h-4 w-4 shrink-0 animate-pulse stroke-[2.2] text-brand transition-transform group-hover:scale-105" />
            <p className="truncate font-medium text-brand/90">
              <span className="mr-1.5 font-bold text-brand">
                {isEn ? "[Notice]" : "[公告]"}
              </span>
              {announcement}
            </p>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 pt-4 pb-4"
      >
        {showLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center space-y-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent"></div>
          </div>
        ) : (messages?.length ?? 0) === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground animate-[fadeIn_0.3s_ease-out_150ms_both]">
            {t("chat.empty")}
          </div>
        ) : (
          <ul className="mx-auto flex max-w-lg flex-col gap-4">
            {(messages ?? []).map((msg, i) => {
              const prev = (messages ?? [])[i - 1];
              const sameSender = prev && prev.user_id === msg.user_id;
              const closeInTime =
                prev &&
                new Date(msg.created_at).getTime() -
                  new Date(prev.created_at).getTime() <
                  GROUP_WINDOW_MS;
              const grouped = !!(sameSender && closeInTime);
              const mine = msg.user_id === userId;
              const member = memberById.get(msg.user_id);
              const checkin = msg.checkin_id ? checkinById.get(msg.checkin_id) : null;
              return (
                <MessageRow
                  key={msg.id}
                  msg={msg}
                  mine={mine}
                  grouped={grouped}
                  member={member}
                  checkin={checkin ?? null}
                  onOpenCheckin={openCheckin}
                  onRecall={recall.mutate}
                  onReedit={handleReedit}
                />
              );
            })}
          </ul>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-border/60 bg-card/85 px-3 py-2 backdrop-blur-xl"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        <div className="mx-auto flex max-w-lg items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.placeholder")}
            maxLength={500}
            rows={1}
            className="min-h-[40px] max-h-[120px] w-full resize-none overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
          />
          <Button
            type="submit"
            disabled={!text.trim() || send.isPending}
            size="icon"
            className="h-11 w-11 shrink-0 self-end bg-brand text-brand-foreground shadow-[0_0_12px_rgba(0,242,254,0.4)] hover:bg-brand/90 disabled:bg-brand/40 disabled:shadow-none"
            aria-label={t("common.send")}
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function MessageRow({
  msg,
  mine,
  grouped,
  member,
  checkin,
  onOpenCheckin,
  onRecall,
  onReedit,
}: {
  msg: Message;
  mine: boolean;
  grouped: boolean;
  member: TripMember | undefined;
  checkin: Checkin | null;
  onOpenCheckin: (id: string) => void;
  onRecall: (msg: Message) => void;
  onReedit: (content: string) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  // 优先使用 Join 出来的 profiles.display_name，禁止用邮箱前缀保底
  const name = msg.profiles?.display_name || member?.display_name || t("common.teammate");
  const time = formatDistanceToNowStrict(new Date(msg.created_at), {
    addSuffix: true,
    locale: locale === "zh" ? zhCN : enUS,
  });

  const isShare = msg.type === "checkin_share";
  // 仅自己发送且未撤回的消息可撤回
  const canRecall = mine && !msg.is_recalled;

  // ===== 撤回交互：手机长按 500ms / 电脑右键，气泡上方弹出黑色胶囊菜单 =====
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const recallFiredRef = useRef(false);

  const clearPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  useEffect(() => clearPress, []);

  const openRecallMenu = () => {
    recallFiredRef.current = false; // 每次打开菜单重置触发锁，允许失败后重试
    setMenuOpen(true);
  };

  // 点击菜单外任意处关闭菜单：capture 阶段 + contains 判定。
  // 不依赖 stopPropagation（合成事件阻断在部分浏览器下不可靠，曾导致
  // pointerdown 先卸载菜单、随后的 click 落空——点击"撤回"毫无反应的根因）
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocDown, true);
    return () => document.removeEventListener("pointerdown", onDocDown, true);
  }, [menuOpen]);

  const startPress = () => {
    if (!canRecall) return;
    clearPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      // 长按弹菜单后屏蔽紧随的 click，避免误触打卡卡片跳转
      suppressClickRef.current = true;
      window.setTimeout(() => (suppressClickRef.current = false), 350);
      navigator.vibrate?.(10);
      openRecallMenu();
    }, 500);
  };

  // 屏蔽原生右键菜单；仅自己的消息弹出撤回菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (canRecall) openRecallMenu();
  };

  // 触发撤回：pointerup + click 双通道兜底，dedup 防重复触发
  const fireRecall = () => {
    if (recallFiredRef.current) return;
    recallFiredRef.current = true;
    setMenuOpen(false);
    onRecall(msg);
  };

  const handleOpenCheckin = (id: string) => {
    if (suppressClickRef.current) return;
    onOpenCheckin(id);
  };

  // ===== 已撤回：全宽居中的系统弱提示 =====
  if (msg.is_recalled) {
    return (
      <li className={`flex w-full items-center justify-center ${grouped ? "mt-1" : "mt-2"}`}>
        <p className="flex flex-wrap items-center justify-center gap-1.5 px-2 text-center text-xs text-muted-foreground/70">
          <span>{mine ? t("chat.recallSelf") : `${name} ${t("chat.recallOther")}`}</span>
          {mine && msg.type === "text" && msg.content && (
            <button
              type="button"
              onClick={() => onReedit(msg.content)}
              className="font-medium text-brand transition-opacity hover:opacity-75"
            >
              {t("chat.reedit")}
            </button>
          )}
        </p>
      </li>
    );
  }

  return (
    <li
      className={`flex items-start gap-2 ${
        mine ? "flex-row-reverse" : "flex-row"
      } ${grouped ? "mt-0.5" : "mt-2"}`}
    >
      {/* 头像：双方均展示，固定最外侧，与昵称/气泡顶部水平对齐（mt-0.5 光学微调）
          全站统一 MemberAvatar — 真实头像 → 专属色首字母圆，与队员栏/票据卡片一致 */}
      <div className="mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-full">
        <MemberAvatar
          member={member}
          fallbackId={msg.user_id}
          fallbackName={name}
          fallbackAvatar={msg.profiles?.avatar_url ?? null}
          textClassName="text-xs font-semibold"
        />
      </div>

      <div
        className={`flex min-w-0 max-w-[75%] flex-col ${
          mine ? "items-end" : "items-start"
        }`}
      >
        {!grouped && !mine && (
          <div className="mb-0.5 px-1 text-[11px] text-muted-foreground">
            {name}
          </div>
        )}

        {/* 气泡 + 撤回菜单挂载点 */}
        <div
          className="relative"
          onTouchStart={startPress}
          onTouchEnd={clearPress}
          onTouchMove={() => {
            clearPress();
            if (menuOpen) setMenuOpen(false);
          }}
          onTouchCancel={clearPress}
          onContextMenu={handleContextMenu}
          style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
        >
          {menuOpen && (
            <div
              ref={menuRef}
              className={`absolute bottom-full z-30 mb-2 whitespace-nowrap rounded-full bg-black/90 px-4 py-1.5 text-xs font-medium text-white shadow-[0_4px_16px_rgba(0,0,0,0.45)] ${
                mine ? "right-0" : "left-0"
              }`}
              // 阻断触摸事件冒泡到外层长按手势监听，
              // 防止点击【撤回】时重新启动 500ms 定时器干扰点击
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onTouchCancel={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={fireRecall}
                // pointerup 通道兜底：即使 click 被浏览器/全局监听吞掉也能触发
                onPointerUp={(e) => {
                  if (e.button !== 0) return;
                  fireRecall();
                }}
                className="transition-opacity hover:opacity-80"
              >
                {t("chat.recall")}
              </button>
            </div>
          )}

          {isShare && checkin ? (
            <button
              type="button"
              onClick={() => handleOpenCheckin(checkin.id)}
              className={`overflow-hidden rounded-2xl border text-left transition-colors ${
                mine
                  ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                  : "border-border/60 bg-muted hover:bg-muted/80"
              }`}
            >
              {checkin.image_url && (
                <SignedImage
                  path={checkin.image_url}
                  alt={checkin.title}
                  className="h-36 w-56 object-cover"
                />
              )}
              <div className="max-w-[224px] px-3 py-2">
                <div className="line-clamp-1 text-sm font-semibold text-foreground">
                  📍 {checkin.title}
                </div>
                {checkin.note && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {checkin.note}
                  </div>
                )}
                <div className="mt-1 text-[11px] font-medium text-primary">
                  {t("chat.viewFootprint")}
                </div>
              </div>
            </button>
          ) : isShare ? (
            <button
              type="button"
              onClick={() => msg.checkin_id && handleOpenCheckin(msg.checkin_id)}
              className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted px-3 py-2 text-sm text-foreground"
            >
              <MapPin className="h-4 w-4 text-primary" />
              <span>{msg.content || t("chat.checkinFootprint")}</span>
            </button>
          ) : (
            <div
              className={`select-none whitespace-pre-wrap break-words px-3 py-2 text-sm ${
                mine
                  ? "rounded-2xl rounded-tr-md border border-brand/40 bg-brand/15 text-brand"
                  : "rounded-2xl rounded-tl-md bg-muted text-foreground"
              }`}
            >
              {msg.content}
            </div>
          )}
        </div>

        <div
          className={`mt-0.5 px-1 text-[10px] ${
            mine
              ? "text-right text-brand/80"
              : "text-left text-muted-foreground"
          }`}
        >
          {time}
        </div>
      </div>
    </li>
  );
}
