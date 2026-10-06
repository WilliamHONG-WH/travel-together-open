import { Star, MapPin, ReceiptText } from "lucide-react";
import { useI18n } from "@/i18n";
import { formatLocalizedReceiptLocation } from "@/utils/location";
import { MemberAvatar } from "@/components/member-avatar";
import { CachedImage } from "@/components/signed-image";
import { getReceiptImages } from "./image-utils";
import type { Receipt, TeamMember } from "./types";

interface Props {
  receipt: Receipt;
  teamMembers: TeamMember[];
  onClick: () => void;
  onToggleStarred?: (id: string) => void;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  } catch {
    return dateStr;
  }
}

export function ReceiptCard({ receipt, teamMembers, onClick, onToggleStarred }: Props) {
  const { locale } = useI18n();
  const symbol = CURRENCY_SYMBOL[receipt.currency || "CNY"] || "¥";
  const formattedPrice = `${symbol}${(receipt.amount || 0).toFixed(2)}`;
  const isStarred = Boolean(receipt.is_starred);

  // 记录人头像：必须绑定 receipt.recorder（记录人本人），
  // 绝不能优先用 receipt.user_id — 那是"上传者/归属人"（票据由谁添加），
  // 票据全由一人代录时 user_id 恒为该用户，会让所有卡片错显
  // 当前登录用户的头像。渲染统一走 MemberAvatar（真实头像 → 专属色首字母圆）
  const matchedMember =
    teamMembers.find((m) => m.user_id === receipt.recorder) || // 标准数据：recorder = 记录人 user_id
    teamMembers.find((m) => receipt.recorder && m.display_name === receipt.recorder) || // 旧数据：recorder 存姓名
    teamMembers.find((m) => receipt.recorder_name && m.display_name === receipt.recorder_name) ||
    teamMembers.find((m) => m.user_id === receipt.user_id); // 兜底：recorder 无法匹配任何人时才按归属人
  const recorderName =
    receipt.recorder_name || matchedMember?.display_name || receipt.recorder || "User";

  // 多语言地点：优先 city_key + detail_address 解析；降级用 location 字符串
  const localizedLocation = formatLocalizedReceiptLocation(
    receipt.city_key || "",
    receipt.detail_address || "",
    locale,
  ) || receipt.location;

  // 拼接副标题：地点 · 日期（地点或日期缺失时自动收敛分隔符）
  const subtitleParts: string[] = [];
  if (localizedLocation) subtitleParts.push(localizedLocation);
  if (receipt.date) subtitleParts.push(formatDate(receipt.date));
  const subtitle = subtitleParts.join(" · ");

  // 多图票据：封面仅展示第 1 张（首图），多图时右下角显示 +N 数量角标
  const images = getReceiptImages(receipt);
  const coverImage = images[0] || "";
  const extraImageCount = images.length - 1;

  return (
    <div
      onClick={onClick}
      className="group relative flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-md transition-all hover:border-border cursor-pointer"
    >
      {/* 左侧：首图封面（无图降级类别图标） + 标题与副标题 */}
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {coverImage ? (
          /* 首图封面 — 14x14 圆角缩略图，多图时右下角 +N 角标 */
          <div className="relative h-14 w-14 shrink-0">
            <CachedImage
              value={coverImage}
              alt={receipt.title}
              className="h-full w-full rounded-xl border border-border object-cover"
              onError={(e) => {
                // 加载失败降级：隐藏破图，显示类别图标底座
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            {/* 破图降级底座：默认隐藏，img onError 时接管显示 */}
            <div
              className="absolute inset-0 hidden h-14 w-14 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand shadow-[0_0_10px_rgba(6,182,212,0.15)]"
            >
              <ReceiptText className="h-5 w-5" />
            </div>
            {extraImageCount > 0 && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold leading-none text-brand-foreground shadow-[0_0_8px_rgba(0,242,254,0.5)] ring-1 ring-card">
                +{extraImageCount}
              </span>
            )}
          </div>
        ) : (
          /* 类别图标 — 11x11 加发光，对齐用户参考代码 */
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand shadow-[0_0_10px_rgba(6,182,212,0.15)]">
            <ReceiptText className="h-5 w-5" />
          </div>
        )}
        {/* 标题 + 副标题（地点 · 日期） */}
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-base font-bold leading-snug text-foreground">
            {receipt.title}
          </h4>
          {subtitle && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {localizedLocation && <MapPin className="h-3 w-3 shrink-0 text-brand/80" />}
              <span className="truncate">{subtitle}</span>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：金额气泡 (左) + 星标/头像垂直复合区 (最右) */}
      <div className="flex shrink-0 items-center gap-3">
        {/* 1. 金额高亮气泡 — 位于星标和头像的左侧 */}
        <div className="rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-sm sm:text-base font-bold text-brand shadow-[0_0_12px_rgba(6,182,212,0.2)]">
          {formattedPrice}
        </div>

        {/* 2. 最右侧：星标 (上) + 头像 (下) 垂直排列，无名称文字 */}
        <div className="flex flex-col items-center justify-center gap-1 min-w-[28px]">
          {/* 星标按钮 — 圆形外框底座，样式对齐百科/StampCard 模块 */}
          {onToggleStarred && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStarred(receipt.id);
              }}
              aria-label="Toggle starred"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${
                isStarred
                  ? "bg-amber-500/15 border border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.35)] scale-105"
                  : "bg-muted/60 border border-border/60 hover:border-border opacity-70 hover:opacity-100"
              }`}
            >
              <Star
                className={`w-4 h-4 transition-transform duration-200 ${
                  isStarred
                    ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                    : "text-muted-foreground"
                }`}
                fill={isStarred ? "currentColor" : "none"}
              />
            </button>
          )}

          {/* 成员头像 (纯圆形，无名称文字)：统一 MemberAvatar — 真实头像 → 专属色首字母圆 */}
          <div className="h-6 w-6 overflow-hidden rounded-full border border-border bg-card">
            <MemberAvatar
              member={matchedMember}
              fallbackId={receipt.recorder}
              fallbackName={recorderName}
              textClassName="text-[10px] font-bold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
