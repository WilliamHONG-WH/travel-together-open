import { useEffect, useMemo, useRef, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { tripMembersQueryOptions, type TripMember } from "@/lib/trip-members";
import { useMemberFilter } from "@/lib/member-filter";
import { MemberAvatar } from "@/components/member-avatar";
import { useT, useI18n } from "@/i18n";

/**
 * 右上角整合型打卡统计器与成员多选筛选器
 *
 * 折叠态：玻璃卡片显示 "FOOTPRINT MAP / N check-ins" + 展开箭头（不带头像）
 * 展开态：下方横向排列成员头像，通过亮暗筛选交互切换高亮/置灰
 *   - 激活（默认全选）：原色高亮 + 青蓝发光环 ring-2 ring-[#00F2FE]
 *   - 未激活：grayscale opacity-40 ring-0
 *   - 点击头像独立切换，地图 Marker 实时联动筛选
 */
export function MemberFilterWidget({
  tripId,
  filter,
  count,
}: {
  tripId: string;
  filter: ReturnType<typeof useMemberFilter>;
  count: number;
}) {
  const { data: members } = useSuspenseQuery(tripMembersQueryOptions(tripId));
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // hiddenCount === 0 表示全部选中（无任何隐藏）
  const allSelected = useMemo(
    () => members.length > 0 && members.every((m) => !filter.hiddenIds.has(m.user_id)),
    [members, filter.hiddenIds],
  );

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto flex flex-col items-end"
    >
      {/* 整合容器：收起态紧凑胶囊，展开态以右上角为基准向左下方扩展 (origin-top-right)，
          顶部右上角起点位置绝对固定，不影响左侧后退按键 */}
      <div
        className={`rounded-2xl border border-border bg-card/90 shadow-2xl backdrop-blur-md transition-all duration-300 origin-top-right overflow-hidden ${
          open ? "w-64 p-3.5" : "w-auto min-w-[120px] px-3 py-1.5"
        }`}
      >
        {/* 顶栏 (收起态：两行文字小胶囊；展开态：同结构 + 下方内容) */}
        <div
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between gap-2 cursor-pointer select-none"
        >
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] font-semibold text-brand tracking-wider">
              {t("map.footprintMap")}
            </span>
            <div className="text-xs font-bold text-foreground flex items-baseline gap-0.5 mt-0.5">
              <span className="text-sm font-extrabold text-brand">{count}</span>
              <span>{t("map.checkins")}</span>
            </div>
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 ml-1 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </div>

        {/* 展开态：横向排列头像 + 亮暗筛选 (向左下扩展，顶部起点绝对不动) */}
        {open && (
          <div className="mt-3 pt-2.5 border-t border-border flex flex-col gap-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-[0.22em]">
                {t("map.travelers")}
              </span>
              <button
                type="button"
                onClick={() => {
                  // 全选 ↔ 清空 切换
                  if (allSelected) filter.clear();
                  else filter.selectAll();
                }}
                className="text-[10px] text-brand transition hover:text-brand hover:underline"
              >
                {allSelected
                  ? isEn
                    ? "Clear All"
                    : "清空"
                  : isEn
                    ? "Select All"
                    : "全选"}
              </button>
            </div>

            {/* 头像横向快捷筛选 */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {members.map((m) => {
                // selected = NOT in hiddenIds（默认全选）
                const selected = !filter.hiddenIds.has(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => filter.toggle(m.user_id)}
                    aria-label={m.display_name}
                    className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-full transition-all duration-200 ${
                      selected
                        ? "scale-100 opacity-100"
                        : "scale-95 opacity-40 grayscale hover:opacity-60"
                    }`}
                  >
                    {/* 全站统一 MemberAvatar（本组件为该样式的原始参照实现） */}
                    <MemberAvatar member={m} textClassName="text-xs font-bold" />
                  </button>
                );
              })}
              {members.length === 0 && (
                <span className="py-3 text-center text-xs text-muted-foreground">
                  {t("filter.noMembers")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
