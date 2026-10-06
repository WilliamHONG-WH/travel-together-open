import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, Receipt as ReceiptIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { tripMembersQueryOptions } from "@/lib/trip-members";
import type { Receipt, TeamMember } from "./types";
import { ReceiptCard } from "./ReceiptCard";
import { ReceiptModal } from "./ReceiptModal";

interface Props {
  tripId: string;
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

export function Receipts({ tripId }: Props) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  const [filter, setFilter] = useState<FilterType>("all");
  // 初始弹窗状态严格为关闭 — 修复进入模块时自动弹窗的 Bug
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: members = [] } = useQuery(tripMembersQueryOptions(tripId));

  useEffect(() => {
    // 安全校验：tripId 为空时直接退出，避免 API 传入 undefined 导致 400
    if (!tripId) {
      setReceipts([]);
      setLoading(false);
      return;
    }

    const loadReceipts = async () => {
      setLoading(true);
      // receipts 表实际不含 trip_id 字段，移除该过滤与字段请求避免 400 Bad Request
      // 列表限制 .limit(30) 防止数据膨胀导致渲染卡死
      const { data, error } = await (supabase as any)
        .from("receipts")
        .select(
          "id, user_id, recorder, title, amount, currency, image_url, location, city_key, detail_address, date, note, recorder_name, recorder_avatar_url, is_shared, is_starred, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);

      if (!error && data) {
        const remote = data as Receipt[];
        const local = loadFromLocal(tripId);
        const remoteIds = new Set(remote.map((r) => r.id));
        const localOnly = local.filter((r) => !remoteIds.has(r.id));
        const merged = [...remote, ...localOnly];
        setReceipts(merged);
        saveToLocal(tripId, merged);
      } else {
        setReceipts(loadFromLocal(tripId));
      }
      setLoading(false);
    };
    loadReceipts();

    // receipts 表无 trip_id 字段，订阅不再按 trip_id 过滤，监听全表变更后重新拉取
    const channel = (supabase as any)
      .channel(`receipts:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipts",
        },
        () => loadReceipts()
      )
      .subscribe();

    return () => {
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
    if (filter === "personal") return !r.is_shared;
    if (filter === "shared") return r.is_shared || r.is_starred;
    return true;
  });

  // 用户主动点击「+ 上传票据」才打开新增弹窗
  const handleOpenAdd = useCallback(() => {
    setEditingReceipt(null);
    setIsAddModalOpen(true);
  }, []);

  // 用户主动点击卡片才打开编辑弹窗
  const handleOpenEdit = useCallback((receipt: Receipt) => {
    setEditingReceipt(receipt);
    setIsAddModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsAddModalOpen(false);
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
  }, [tripId]);

  const handleDelete = useCallback((id: string) => {
    setReceipts((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveToLocal(tripId, next);
      return next;
    });
  }, [tripId]);

  const isModalOpen = isAddModalOpen && (editingReceipt !== null || teamMembers.length > 0);

  return (
    <div className="mt-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5 ring-1 ring-border">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
              filter === "all"
                ? "bg-brand text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isEn ? "All" : "全部"}
          </button>
          <button
            type="button"
            onClick={() => setFilter("personal")}
            className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
              filter === "personal"
                ? "bg-brand text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isEn ? "Personal" : "个人"}
          </button>
          <button
            type="button"
            onClick={() => setFilter("shared")}
            className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
              filter === "shared"
                ? "bg-brand text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {isEn ? "Team Shared" : "团队共享"}
          </button>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-1 rounded-full bg-brand px-3.5 py-1 text-xs font-bold text-brand-foreground shadow-[0_0_10px_rgba(0,242,254,0.4)] transition-all hover:bg-brand/90"
        >
          <Plus className="h-3.5 w-3.5" />
          {isEn ? "Upload Receipt" : "上传票据"}
        </button>
      </div>

      {/* Receipts List */}
      <div className="mt-4 flex flex-col gap-3">
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

      {/* Modal — only render when user explicitly opens it */}
      {isModalOpen && (
        <ReceiptModal
          receipt={editingReceipt}
          teamMembers={teamMembers}
          onClose={handleCloseModal}
          onSave={handleSave}
          onDelete={handleDelete}
          tripId={tripId}
        />
      )}
    </div>
  );
}
