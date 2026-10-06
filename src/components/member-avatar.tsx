import { useState } from "react";
import { usePrivateImage } from "@/lib/image-cache";
import { hashHue } from "@/lib/member-filter";

/**
 * 全站统一成员头像组件（票据 / 足迹 / 地图 / 聊天 / 队员栏共用）
 *
 * 渲染规则（与右上角 Travelers 队员栏完全一致）：
 * 1. 成员配置了 avatar_url → 渲染真实头像图片（加载失败自动降级规则 3）
 * 2. 未匹配到成员（如已退队）但传入历史头像快照 → 渲染快照图片
 * 3. 未配置头像 → hashHue(user_id) 专属背景色 + 白色大写首字母圆圈
 *
 * 同一成员在全站任何模块背景色与图片完全一致：颜色由 user_id 哈希决定
 * （lml616 → 紫、Ji Shen → 红），修改资料头像后所有模块自动联动。
 *
 * 用法：外层由调用方提供尺寸/圆角/边框容器，本组件自适应填满：
 *   <div className="h-9 w-9 overflow-hidden rounded-full">
 *     <MemberAvatar member={m} textClassName="text-xs font-semibold" />
 *   </div>
 */
export interface AvatarMemberLike {
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface MemberAvatarProps {
  /** 成员对象（trip_members 实时数据）；无则用 fallback 身份 */
  member?: AvatarMemberLike | null;
  /** 兜底身份：user_id（决定首字母圆背景色，与队员栏同算法） */
  fallbackId?: string | null;
  /** 兜底身份：显示名（决定首字母） */
  fallbackName?: string | null;
  /** 历史头像快照：仅当成员未匹配到时兜底使用 */
  fallbackAvatar?: string | null;
  /** 图片额外样式（默认 h-full w-full object-cover） */
  imgClassName?: string;
  /** 首字母字号/字重类名 */
  textClassName?: string;
}

export function MemberAvatar({
  member,
  fallbackId,
  fallbackName,
  fallbackAvatar,
  imgClassName = "",
  textClassName = "",
}: MemberAvatarProps) {
  const [error, setError] = useState(false);

  const resolvedName = member?.display_name || fallbackName || "?";
  const hueKey = member?.user_id || fallbackId || resolvedName;
  const hue = hashHue(hueKey);
  const initial = (resolvedName.trim().charAt(0) || "?").toUpperCase();

  // 优先级：成员实时头像 → 快照头像（仅成员未匹配时）→ 专属色首字母圆
  const liveAvatar = member?.avatar_url || null;
  const snapshotAvatar = !member ? fallbackAvatar || null : null;
  // 头像存于私密桶 avatars（profiles.avatar_url 可能是历史 getPublicUrl 完整 URL，
  // usePrivateImage 会自动反解为 bucket+path 走本地 IndexedDB 缓存链路）
  const avatarValue = liveAvatar || snapshotAvatar;
  const resolvedAvatar = usePrivateImage(avatarValue, "avatars");
  const src = !error && resolvedAvatar ? resolvedAvatar : null;

  if (src) {
    return (
      <img
        src={src}
        alt={resolvedName}
        className={`h-full w-full object-cover ${imgClassName}`}
        referrerPolicy="no-referrer"
        onError={() => setError(true)}
      />
    );
  }
  if (avatarValue && !resolvedAvatar) {
    // 私密图缓存解析中：渲染中性骨架占位（解析完成后自动切换为真实头像）
    return (
      <span
        className={`block h-full w-full animate-pulse bg-muted/60 ${imgClassName}`}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={`flex h-full w-full items-center justify-center text-white ${textClassName}`}
      style={{ background: `hsl(${hue} 65% 45%)` }}
    >
      {initial}
    </span>
  );
}
