import { useCallback, useEffect, useMemo, useState } from "react";

const keyOf = (tripId: string) => `trip-filter:${tripId}`;

function readHidden(tripId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(keyOf(tripId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeHidden(tripId: string, hidden: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyOf(tripId), JSON.stringify([...hidden]));
}

export function useMemberFilter(tripId: string, allUserIds: string[]) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => readHidden(tripId));

  useEffect(() => {
    setHiddenIds(readHidden(tripId));
  }, [tripId]);

  const persist = useCallback(
    (next: Set<string>) => {
      writeHidden(tripId, next);
      setHiddenIds(next);
    },
    [tripId],
  );

  const toggle = useCallback(
    (userId: string) => {
      const next = new Set(hiddenIds);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      persist(next);
    },
    [hiddenIds, persist],
  );

  const selectAll = useCallback(() => persist(new Set()), [persist]);
  const clear = useCallback(
    () => persist(new Set(allUserIds)),
    [persist, allUserIds],
  );

  const visibleIds = useMemo(
    () => allUserIds.filter((id) => !hiddenIds.has(id)),
    [allUserIds, hiddenIds],
  );

  return { hiddenIds, visibleIds, toggle, selectAll, clear };
}

export function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
