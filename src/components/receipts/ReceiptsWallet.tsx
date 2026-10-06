import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Loader2, Receipt as ReceiptIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import type { Receipt, TeamMember } from "./types";
import { getReceiptImages } from "./image-utils";
import { ReceiptCard } from "./ReceiptCard";
import { AddReceiptModal } from "./AddReceiptModal";
import { ReceiptDetailModal } from "./ReceiptDetailModal";

interface Props {
  tripId: string;
  currentUserId: string | null;
}

type FilterType = "all" | "personal" | "shared";

const STORAGE_KEY = (tripId: string) => `receipts:${tripId}`;

function loadFromLocal(tripId: string): Receipt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Receipt[]) : [];
  } catch {
    return [];
  }
}

function saveToLocal(tripId: string, list: Receipt[]) {
  try {
    localStorage.setItem(STORAGE_KEY(tripId), JSON.stringify(list));
  } catch (err) {
    console.warn("localStorage save failed:", err);
  }
}

export function ReceiptsWallet({ tripId, currentUserId }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<FilterType>("personal");
  // 弹窗状态严格默认为关闭 — 彻底修复进入模块时自动弹窗的 Bug
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  // 初始值优先读取 localStorage 缓存，有缓存时直接渲染（0ms 秒开），无缓存才显示 Loading
  const [receipts, setReceipts] = useState<Receipt[]>(() => loadFromLocal(tripId));
  const [loading, setLoading] = useState(() => !loadFromLocal(tripId));
  // 静默刷新函数引用：供保存/删除/星标后立即重拉远端数据（多端同步保底）
  const silentRefreshRef = useRef<() => void>(() => {});

  const { data: members = [] } = useQuery(tripMembersQueryOptions(tripId));

  useEffect(() => {
    // 安全校验：tripId 为空时直接退出，避免 API 传入 undefined 导致 400
    if (!tripId) {
      setReceipts([]);
      setLoading(false);
      return;
    }

    const loadReceipts = async (silent = false) => {
      // 静默刷新时不展示全屏 Loading，保留缓存数据直接渲染
      if (!silent) setLoading(true);

      // 多端同步核心逻辑：
      // 1. 只按 trip_id 过滤，绝不加 user_id 过滤 — 其他队员分享的票据必须能拉回来
      // 2. 个人/团队共享的区分在前端内存中按 Tab 过滤（见下方 filteredReceipts）
      // 列表限制 .limit(50) 防止数据膨胀导致渲染卡死
      const selectCols =
        "id, trip_id, user_id, recorder, title, amount, currency, image_url, images, city_key, detail_address, location, date, note, recorder_name, recorder_avatar_url, is_shared, is_starred, created_at, updated_at";
      let { data, error } = await (supabase as any)
        .from("receipts")
        .select(selectCols)
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(50);

      // 降级兼容：线上表若尚未执行 SQL 补 trip_id 列（PGRST204 / 42703），
      // 自动降级为无 trip_id 过滤的全量拉取，保证迁移前功能可用
      if (error && /trip_id|PGRST204|42703/i.test(error.message || "")) {
        console.warn("[ReceiptsWallet] trip_id column missing, fallback to unfiltered fetch. 请执行 RLS 修复 SQL。");
        ({ data, error } = await (supabase as any)
          .from("receipts")
          .select(selectCols.replace("trip_id, ", ""))
          .order("created_at", { ascending: false })
          .limit(50));
      }

      if (!error && data) {
        // 规范化：远端数据统一保证 images 数组存在（旧数据 image_url → images[0]）
        const remote = (data as Receipt[]).map((r) => ({
          ...r,
          images: getReceiptImages(r),
        }));
        const local = loadFromLocal(tripId);
        const remoteIds = new Set(remote.map((r) => r.id));
        const localOnly = local.filter((r) => !remoteIds.has(r.id));
        const merged = [...remote, ...localOnly];
        setReceipts(merged);
        saveToLocal(tripId, merged);
      } else if (error) {
        // 拉取失败（网络/权限）：降级本地缓存，同时把错误暴露到控制台便于排查
        console.warn("[ReceiptsWallet] fetch failed:", error);
        setReceipts(loadFromLocal(tripId));
      }
      setLoading(false);
    };
    // 首次加载：有缓存则静默刷新，无缓存则展示 Loading
    loadReceipts(!!loadFromLocal(tripId));

    // 保存静默刷新引用，供本端保存/删除/星标后立即同步远端最新状态
    silentRefreshRef.current = () => loadReceipts(true);

    // Realtime 实时同步：监听 receipts 全表变更（需在 Supabase 执行
    // ALTER PUBLICATION supabase_realtime ADD TABLE receipts 后生效），
    // 手机端一提交，电脑端无需手动刷新即可收到推送重拉列表
    const channel = (supabase as any)
      .channel(`receipts:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipts",
        },
        () => loadReceipts(true)
      )
      .subscribe();

    return () => {
      silentRefreshRef.current = () => {};
      (supabase as any).removeChannel(channel);
    };
  }, [tripId]);

  const teamMembers: TeamMember[] = members.map((m) => ({
    id: m.user_id,
    user_id: m.user_id,
    display_name: m.display_name || "User",
    avatar_url: m.avatar_url,
  }));

  const filteredReceipts = receipts.filter((r) => {
    // 前端内存过滤（数据库查询只按 trip_id，绝不按 user_id）：
    // user_id 优先，旧数据 user_id 为空时兜底 recorder
    const receiptUserId = r.user_id || r.recorder;
    if (filter === "personal") {
      // 个人票据：仅展示当前登录用户自己创建/添加的票据
      return receiptUserId === currentUserId;
    }
    if (filter === "shared") {
      // 团队共享：展示开启同步 (is_shared) 或被打上星标 (is_starred) 的票据 —
      // 无论谁在什么设备上标记共享，全团所有设备的此 Tab 都能看到
      return r.is_shared === true || r.is_starred === true;
    }
    // All：展示当前用户可查看的所有票据
    return receiptUserId === currentUserId || r.is_shared === true || r.is_starred === true;
  });

  // 用户主动点击「+ 上传票据」才打开新增弹窗
  const handleOpenAdd = useCallback(() => {
    setEditingReceipt(null);
    setIsAddModalOpen(true);
  }, []);

  // 用户主动点击卡片才打开编辑弹窗
  const handleOpenEdit = useCallback((receipt: Receipt) => {
    setEditingReceipt(receipt);
    setIsAddModalOpen(false);
  }, []);

  const handleCloseAddModal = useCallback(() => {
    setIsAddModalOpen(false);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditingReceipt(null);
  }, []);

  const handleSave = useCallback((updated: Receipt) => {
    setReceipts((prev) => {
      const idx = prev.findIndex((r) => r.id === updated.id);
      if (idx >= 0) {
        const next = prev.map((r) => (r.id === updated.id ? updated : r));
        saveToLocal(tripId, next);
        return next;
      }
      const next = [updated, ...prev];
      saveToLocal(tripId, next);
      return next;
    });
    // 强制失效 React Query 缓存 + 静默重拉远端，保证多端数据一致
    queryClient.invalidateQueries({ queryKey: ["receipts", tripId] });
    silentRefreshRef.current();
  }, [tripId, queryClient]);

  const handleDelete = useCallback((id: string) => {
    setReceipts((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveToLocal(tripId, next);
      return next;
    });
    setEditingReceipt(null);
    queryClient.invalidateQueries({ queryKey: ["receipts", tripId] });
    silentRefreshRef.current();
  }, [tripId, queryClient]);

  const handleToggleStarred = useCallback(async (id: string) => {
    // 安全校验：id 为空时直接退出，避免 .eq("id", undefined) 导致 API 异常
    if (!id) return;
    const receipt = receipts.find((r) => r.id === id);
    if (!receipt) return;

    const nextStarred = !Boolean(receipt.is_starred);
    // 卡片星标与团队同步强绑定：同时更新 is_starred 和 is_shared
    const updated = { ...receipt, is_starred: nextStarred, is_shared: nextStarred };

    try {
      const { error } = await (supabase as any)
        .from("receipts")
        .update({ is_starred: nextStarred, is_shared: nextStarred })
        .eq("id", id);
      if (error) {
        console.warn("[ReceiptsWallet] star toggle failed:", error);
      }
    } catch (dbErr) {
      console.warn("[ReceiptsWallet] star toggle failed:", dbErr);
    }

    const localList = loadFromLocal(tripId);
    const idx = localList.findIndex((r) => r.id === id);
    if (idx >= 0) {
      localList[idx] = updated;
      saveToLocal(tripId, localList);
    }

    setReceipts((prev) => prev.map((r) => (r.id === id ? updated : r)));
    queryClient.invalidateQueries({ queryKey: ["receipts", tripId] });
  }, [receipts, tripId, queryClient]);

  return (
    <div className="mt-4">
      {/* 顶部筛选与新建工具栏 — 全模块统一 h-11 固定高度，消除 Tab 切换抖动 */}
      <div className="flex items-center justify-between gap-2 h-11 my-3 px-1">
        {/* 左侧：个人 / 团队共享 (移除“全部”，默认选中“个人”) */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/80 border border-border rounded-full">
          <button
            type="button"
            onClick={() => setFilter("personal")}
            className={`h-7 px-3.5 rounded-full text-xs font-medium transition-all ${
              filter === "personal"
                ? "bg-brand/15 text-brand"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isEn ? "Personal" : "个人"}
          </button>
          <button
            type="button"
            onClick={() => setFilter("shared")}
            className={`h-7 px-3.5 rounded-full text-xs font-medium transition-all ${
              filter === "shared"
                ? "bg-brand/15 text-brand"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isEn ? "Team Shared" : "团队共享"}
          </button>
        </div>

        {/* 右侧：新建圆形按键 — 全模块统一 w-10 h-10 shrink-0 */}
        <button
          type="button"
          onClick={handleOpenAdd}
          aria-label={isEn ? "Upload Receipt" : "上传票据"}
          title={isEn ? "Upload Receipt" : "上传票据"}
          className="w-10 h-10 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground font-bold flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-transform active:scale-95 shrink-0"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      {/* Receipts List — 通铺大气泡卡片：单列 100% 宽度，杜绝 grid-cols-2 压缩 */}
      <div className="w-full flex flex-col gap-3.5 px-4 my-4">
        {loading ? (
          <div className="mt-10 flex flex-col items-center justify-center text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {isEn ? "Loading..." : "加载中..."}
            </p>
          </div>
        ) : receipts.length === 0 ? (
          <div className="mt-10 flex flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted border border-border">
              <ReceiptIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              {isEn ? "No receipts yet. Upload one to get started!" : "暂无票据，上传一张开始吧！"}
            </p>
          </div>
        ) : (
          filteredReceipts.map((receipt) => (
            <ReceiptCard
              key={receipt.id}
              receipt={receipt}
              teamMembers={teamMembers}
              onClick={() => handleOpenEdit(receipt)}
              onToggleStarred={handleToggleStarred}
            />
          ))
        )}
      </div>

      {!loading && filteredReceipts.length === 0 && receipts.length > 0 && (
        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">
            {isEn ? "No receipts match this filter." : "没有符合此筛选条件的票据。"}
          </p>
        </div>
      )}

      {/* Add Modal — only render when user explicitly clicks upload button */}
      {isAddModalOpen && (
        <AddReceiptModal
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          isOpen={isAddModalOpen}
          onClose={handleCloseAddModal}
          onSave={handleSave}
          tripId={tripId}
        />
      )}

      {/* Edit Modal — only render when user explicitly clicks a card */}
      {editingReceipt && (
        <ReceiptDetailModal
          receipt={editingReceipt}
          teamMembers={teamMembers}
          onClose={handleCloseEditModal}
          onSave={handleSave}
          onDelete={handleDelete}
          tripId={tripId}
        />
      )}
    </div>
  );
}
