import { useState, useEffect, useCallback, useRef } from "react";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { useAssets } from "@/features/assets/useAssets";
import { statusLabel } from "@/lib/format";
import type { Asset, AssetStatus, AssetQuery } from "@/lib/types";
import { chunkArray, runWithConcurrency } from "@/lib/concurrency";
import { bulkSetStatus } from "@/api/client";
import type { BulkResult } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];
const SORTS: Array<{ value: NonNullable<AssetQuery["sort"]>; label: string }> =
  [
    { value: "updatedAt:desc", label: "Recently updated" },
    { value: "name:asc", label: "Name A–Z" },
    { value: "sizeBytes:desc", label: "Largest first" },
    { value: "createdAt:desc", label: "Newest" },
  ];

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q") ?? "";
  const sort =
    (params.get("sort") as NonNullable<AssetQuery["sort"]>) || "updatedAt:desc";

  const statusParam = params.get("status");
  const status: AssetStatus[] = statusParam
    ? (statusParam
        .split(",")
        .filter((s) => STATUSES.includes(s as AssetStatus)) as AssetStatus[])
    : [];

  const kindParam = params.get("kind");
  const kind: NonNullable<AssetQuery["kind"]> = kindParam
    ? (kindParam.split(",").filter(Boolean) as NonNullable<AssetQuery["kind"]>)
    : [];

  const tagParam = params.get("tag");
  const tag: string[] = tagParam ? tagParam.split(",").filter(Boolean) : [];
  const activeId = params.get("activeId") || null;

  return { q, sort, status, kind, tag, activeId };
}

export function App() {
  const initial = readUrlParams();

  const [searchInput, setSearchInput] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [kind, setKind] = useState<AssetQuery["kind"]>(initial.kind);
  const [tag, setTag] = useState<string[]>(initial.tag);

  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [sort, setSort] = useState<NonNullable<AssetQuery["sort"]>>(
    initial.sort,
  );
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  // Recovery & Undo State (Task 3 Checkpoint 4)
  const [retryableFailedIds, setRetryableFailedIds] = useState<string[]>([]);
  const [pendingStatus, setPendingStatus] = useState<AssetStatus | null>(null);
  const [undoPlan, setUndoPlan] = useState<Map<string, AssetStatus> | null>(
    null,
  );

  // Persistent anchor & snapshot refs for multi-step Shift+Click range selections
  const anchorIdRef = useRef<string | null>(null);
  const baseSelectionRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    if (status.length > 0) params.set("status", status.join(","));
    if (sort !== "updatedAt:desc") params.set("sort", sort);
    if (activeId) params.set("activeId", activeId);
    if (kind && kind.length > 0) params.set("kind", kind.join(","));
    if (tag && tag.length > 0) params.set("tag", tag.join(","));

    const queryStr = params.toString();
    const targetUrl = queryStr
      ? `${window.location.pathname}?${queryStr}`
      : window.location.pathname;

    window.history.replaceState(null, "", targetUrl);
  }, [debouncedQ, status, sort, activeId, kind, tag]);

  useEffect(() => {
    function handlePopState() {
      const current = readUrlParams();
      setSearchInput(current.q);
      setDebouncedQ(current.q);
      setStatus(current.status);
      setKind(current.kind);
      setTag(current.tag);
      setSort(current.sort);
      setActiveId(current.activeId);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const {
    items,
    total,
    nextCursor,
    loading,
    loadingMore,
    error,
    refetch,
    loadMore,
    mutateAssetLocal,
  } = useAssets({
    q: debouncedQ,
    status,
    kind,
    tag,
    sort,
  });

  const itemsRef = useRef<Asset[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const toggleSelect = useCallback((id: string, shiftKey: boolean = false) => {
    setSelectedIds((prev) => {
      const currentItems = itemsRef.current;

      if (shiftKey && anchorIdRef.current) {
        const anchorIdx = currentItems.findIndex(
          (a) => a.id === anchorIdRef.current,
        );
        const currentIdx = currentItems.findIndex((a) => a.id === id);

        if (anchorIdx !== -1 && currentIdx !== -1) {
          const next = new Set(baseSelectionRef.current);
          const start = Math.min(anchorIdx, currentIdx);
          const end = Math.max(anchorIdx, currentIdx);

          for (let i = start; i <= end; i++) {
            const item = currentItems[i];
            if (item) {
              next.add(item.id);
            }
          }

          return next;
        }
      }

      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      anchorIdRef.current = id;
      baseSelectionRef.current = new Set(next);
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    anchorIdRef.current = null;
    baseSelectionRef.current = new Set();
  }, []);

  const handleSelectAllLoaded = useCallback(() => {
    const allIds = new Set(itemsRef.current.map((a) => a.id));
    setSelectedIds(allIds);
    baseSelectionRef.current = allIds;
  }, []);

  function handleSaved(updatedAsset: Asset) {
    mutateAssetLocal(updatedAsset.id, updatedAsset);
    setNotice(`Saved "${updatedAsset.name}".`);
  }

  async function executeBulkUpdate(
    targetIds: string[],
    newStatus: AssetStatus,
  ) {
    if (targetIds.length === 0) return;

    // 1. Snapshot previous state for selective rollback and undo
    const currentItemsMap = new Map(itemsRef.current.map((a) => [a.id, a]));
    const previousStatuses = new Map<string, AssetStatus>();
    for (const id of targetIds) {
      const existing = currentItemsMap.get(id);
      if (existing) {
        previousStatuses.set(id, existing.status);
      }
    }

    // 2. Apply optimistic update to UI immediately
    targetIds.forEach((id) => {
      mutateAssetLocal(id, { status: newStatus });
    });

    handleClearSelection();
    setNotice(
      `Applying "${statusLabel(newStatus)}" to ${targetIds.length} asset(s)...`,
    );

    // 3. Chunk payload into batches of <= 50 IDs
    const BATCH_SIZE = 50;
    const batches = chunkArray(targetIds, BATCH_SIZE);

    // 4. Bounded concurrency (max 3 requests parallel)
    const tasks = batches.map((batch) => async () => {
      try {
        return await bulkSetStatus(batch, newStatus);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Network failure";
        return {
          results: batch.map((id) => ({
            id,
            ok: false as const,
            code: "network_error",
            message: errorMsg,
          })),
          applied: 0,
          failed: batch.length,
        } as BulkResult;
      }
    });

    try {
      const batchResults = await runWithConcurrency(tasks, 3);

      // 5. Aggregate HTTP 207 results
      let totalApplied = 0;
      const legalHoldFails: string[] = [];
      const transientFails: string[] = [];
      const successfulUndoMap = new Map<string, AssetStatus>();

      for (const batchRes of batchResults) {
        for (const res of batchRes.results) {
          if (res.ok) {
            totalApplied++;
            const prev = previousStatuses.get(res.id);
            if (prev) successfulUndoMap.set(res.id, prev);
          } else {
            // Roll back ONLY this failed asset to its previous status
            const prevStatus = previousStatuses.get(res.id);
            if (prevStatus) {
              mutateAssetLocal(res.id, { status: prevStatus });
            }

            if (res.code === "legal_hold") {
              legalHoldFails.push(res.id);
            } else {
              transientFails.push(res.id);
            }
          }
        }
      }

      // Store successful modifications for optional undo
      setUndoPlan(successfulUndoMap.size > 0 ? successfulUndoMap : null);

      // 6. Detailed feedback
      const totalFailed = legalHoldFails.length + transientFails.length;
      if (totalFailed === 0) {
        setNotice(
          `Successfully updated all ${totalApplied} asset(s) to "${statusLabel(newStatus)}".`,
        );
        setRetryableFailedIds([]);
        setPendingStatus(null);
      } else {
        const messages: string[] = [];
        if (totalApplied > 0) messages.push(`${totalApplied} succeeded`);
        if (legalHoldFails.length > 0)
          messages.push(
            `${legalHoldFails.length} blocked by legal-hold (never retried)`,
          );
        if (transientFails.length > 0)
          messages.push(`${transientFails.length} failed transiently`);

        setNotice(
          `Bulk update finished with partial success: ${messages.join(", ")}.`,
        );
        setRetryableFailedIds(transientFails);
        setPendingStatus(newStatus);
      }
    } catch (err) {
      previousStatuses.forEach((prev, id) => {
        mutateAssetLocal(id, { status: prev });
      });
      setNotice(err instanceof Error ? err.message : "Bulk update failed");
    }
  }

  function handleBulkStatus(newStatus: AssetStatus) {
    executeBulkUpdate(Array.from(selectedIds), newStatus);
  }

  // Checkpoint 4: Undo handler
  async function handleUndo() {
    if (!undoPlan || undoPlan.size === 0) return;
    const plan = new Map(undoPlan);
    setUndoPlan(null);
    setNotice(`Reverting ${plan.size} asset(s)...`);

    // Group assets by target rollback status
    const byStatus = new Map<AssetStatus, string[]>();
    plan.forEach((prevStatus, id) => {
      const list = byStatus.get(prevStatus) ?? [];
      list.push(id);
      byStatus.set(prevStatus, list);
    });

    for (const [st, ids] of byStatus.entries()) {
      await executeBulkUpdate(ids, st);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) =>
                setStatus((prev) =>
                  e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        <span className="muted">
          {loading
            ? "Updating..."
            : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>
            <strong>{selectedIds.size}</strong> selected
          </span>
          {selectedIds.size < items.length && (
            <button onClick={handleSelectAllLoaded}>
              Select all loaded ({items.length.toLocaleString()})
            </button>
          )}
          <button onClick={handleClearSelection}>Clear selection</button>
          <span className="muted">| Set status:</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => handleBulkStatus(s)}>
              {statusLabel(s)}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          className="notice"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span>{notice}</span>
          {retryableFailedIds.length > 0 && pendingStatus && (
            <button
              onClick={() => {
                const ids = [...retryableFailedIds];
                const st = pendingStatus;
                setRetryableFailedIds([]);
                setPendingStatus(null);
                executeBulkUpdate(ids, st);
              }}
              style={{
                background: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              Retry {retryableFailedIds.length} failed
            </button>
          )}
          {undoPlan && (
            <button
              onClick={handleUndo}
              style={{
                background: "#555",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {error && !loading && (
        <div
          className="error-banner"
          style={{
            padding: "12px",
            background: "#ffebee",
            color: "#c62828",
            margin: "8px 16px",
          }}
        >
          <strong>Error loading assets:</strong> {error}
          <button onClick={() => refetch()} style={{ marginLeft: "12px" }}>
            Try again
          </button>
        </div>
      )}

      <main className={`content ${loading ? "content-pending" : ""}`}>
        {!loading && !error && items.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing matches these filters.</h3>
            <p>Clear the search box or widen the status filter.</p>
          </div>
        ) : (
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
            hasNextPage={Boolean(nextCursor)}
            isFetchingNextPage={loadingMore}
            onLoadMore={loadMore}
          />
        )}

        {activeId && (
          <AssetDetail
            id={activeId}
            onClose={() => setActiveId(null)}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
}
