import { useState, useEffect, useCallback, useRef } from "react";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { useAssets } from "@/features/assets/useAssets";
import { formatBytes, getHumanErrorMessage, statusLabel } from "@/lib/format";
import type { Asset, AssetStatus, AssetQuery } from "@/lib/types";
import { chunkArray, runWithConcurrency } from "@/lib/concurrency";
import { bulkSetStatus } from "@/api/client";
import type { BulkResult } from "@/lib/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

const SORTS: Array<{
  value: NonNullable<AssetQuery["sort"]>;
  label: string;
}> = [
  { value: "updatedAt:desc", label: "Recently updated" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "sizeBytes:desc", label: "Largest first" },
  { value: "createdAt:desc", label: "Newest" },
];

interface LibraryStats {
  totalCount?: number;
  total?: number;
  count?: number;
  totalSizeBytes?: number;
  totalBytes?: number;
  sizeBytes?: number;
}

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

  // Dark mode theme state
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("mv-theme") as "light" | "dark" | null;
      if (stored === "light" || stored === "dark") return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mv-theme", theme);
  }, [theme]);

  // Non-blocking /api/stats state
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LibraryStats | null) => {
        if (isMounted && data) {
          setLibraryStats(data);
        }
      })
      .catch(() => {
        // Non-blocking: fail silently without degrading core workflow
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const [searchInput, setSearchInput] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);

  const [kind, setKind] = useState<AssetQuery["kind"]>(initial.kind);
  const [tag, setTag] = useState<string[]>(initial.tag);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [sort, setSort] = useState<NonNullable<AssetQuery["sort"]>>(initial.sort);
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  // Screen reader announcements: dedicated assertive buffer for instant Space selection feedback
  const [srAnnouncement, setSrAnnouncement] = useState<string>("");

  // Recovery & Undo State
  const [retryableFailedIds, setRetryableFailedIds] = useState<string[]>([]);
  const [pendingStatus, setPendingStatus] = useState<AssetStatus | null>(null);
  const [undoPlan, setUndoPlan] = useState<Map<string, AssetStatus> | null>(null);

  // Online / Offline detection
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  // Roving tabindex & focus restoration refs
  const [focusedIndex, setFocusedIndex] = useState(0);
  const lastActiveIdRef = useRef<string | null>(null);

  // Persistent anchor & snapshot refs for multi-step Shift+Click range selections
  const anchorIdRef = useRef<string | null>(null);
  const baseSelectionRef = useRef<Set<string>>(new Set());

  // Stable references for SSE guards to avoid reconnection thrashing & stale closures
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

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

  // Online / offline event listeners with automatic re-sync
  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
      setNotice("Internet connection restored. Re-syncing latest assets...");
      refetch();
    }

    function handleOffline() {
      setIsOffline(true);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refetch]);

  const itemsRef = useRef<Asset[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Live Updates Stream (GET /api/events)
  // Kept stable without tearing down on selection or drawer toggle
  useEffect(() => {
    if (typeof window === "undefined" || isOffline) return;

    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource("/api/events");

      const handleAssetUpdated = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          const updatedAsset: Asset = raw?.asset ?? raw;

          if (!updatedAsset || !updatedAsset.id) return;

          // Guard 1: Do not overwrite the active selection in bulk action buffer
          if (selectedIdsRef.current.has(updatedAsset.id)) {
            return;
          }

          // In-place mutation: preserves list length, item keys, and virtual scroll coordinates
          mutateAssetLocal(updatedAsset.id, updatedAsset);
        } catch {
          // Silently ignore non-JSON frames
        }
      };

      eventSource.addEventListener("asset.updated", handleAssetUpdated);
      eventSource.addEventListener("message", handleAssetUpdated);

      eventSource.onerror = () => {
        // Automatically attempts reconnection
      };
    } catch {
      // Gracefully handle unsupported environments
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isOffline, mutateAssetLocal]);

  const toggleSelect = useCallback((id: string, shiftKey: boolean = false) => {
    setSelectedIds((prev) => {
      const currentItems = itemsRef.current;
      const target = currentItems.find((a) => a.id === id);

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

          setSrAnnouncement(`Selected ${next.size} assets`);
          return next;
        }
      }

      const next = new Set(prev);
      const isNowSelected = !next.has(id);

      if (isNowSelected) {
        next.add(id);
      } else {
        next.delete(id);
      }

      anchorIdRef.current = id;
      baseSelectionRef.current = new Set(next);

      if (target) {
        setSrAnnouncement(
          `${target.name}, ${isNowSelected ? "selected" : "unselected"}`,
        );
      }
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

  const handleOpenDetail = useCallback((id: string) => {
    lastActiveIdRef.current = id;
    setActiveId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    const returnTargetId = lastActiveIdRef.current;
    setActiveId(null);

    if (returnTargetId) {
      setTimeout(() => {
        const targetCard = document.querySelector<HTMLElement>(
          `[data-asset-id="${returnTargetId}"]`,
        );
        targetCard?.focus();
      }, 16);
    }
  }, []);

  async function executeBulkUpdate(
    targetIds: string[],
    newStatus: AssetStatus,
  ) {
    if (targetIds.length === 0) return;

    if (isOffline) {
      setNotice("You are offline. Reconnect to apply bulk status changes.");
      return;
    }

    const currentItemsMap = new Map(itemsRef.current.map((a) => [a.id, a]));
    const previousStatuses = new Map<string, AssetStatus>();

    for (const id of targetIds) {
      const existing = currentItemsMap.get(id);
      if (existing) {
        previousStatuses.set(id, existing.status);
      }
    }

    targetIds.forEach((id) => {
      mutateAssetLocal(id, { status: newStatus });
    });

    handleClearSelection();
    setNotice(
      `Applying "${statusLabel(newStatus)}" to ${targetIds.length} asset(s)...`,
    );

    const BATCH_SIZE = 50;
    const batches = chunkArray(targetIds, BATCH_SIZE);

    const tasks = batches.map((batch) => async () => {
      try {
        return await bulkSetStatus(batch, newStatus);
      } catch (err) {
        return {
          results: batch.map((id) => ({
            id,
            ok: false as const,
            code: "network_error",
            message: getHumanErrorMessage(err),
          })),
          applied: 0,
          failed: batch.length,
        } as BulkResult;
      }
    });

    try {
      const batchResults = await runWithConcurrency(tasks, 3);
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

      setUndoPlan(successfulUndoMap.size > 0 ? successfulUndoMap : null);

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
      setNotice(getHumanErrorMessage(err));
    }
  }

  function handleBulkStatus(newStatus: AssetStatus) {
    executeBulkUpdate(Array.from(selectedIds), newStatus);
  }

  async function handleUndo() {
    if (!undoPlan || undoPlan.size === 0) return;
    const plan = new Map(undoPlan);
    setUndoPlan(null);
    setNotice(`Reverting ${plan.size} asset(s)...`);

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
      {/* Immediate interaction live region (Spacebar selection) */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {srAnnouncement}
      </div>

      {/* Polite live region for debounced count announcements and bulk messages */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {notice || `${items.length} assets displayed of ${total}`}
      </div>

      {/* Top Workspace Header */}
      <header className="topbar">
        <div className="brand">
          <div className="brand__logo" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <span className="brand__title">MediaVault</span>
        </div>

        <div className="search-wrap">
          <svg
            className="search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search"
            type="search"
            placeholder="Search assets (name, tag, owner)..."
            value={searchInput}
            aria-label="Search assets"
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="topbar-actions">
          {libraryStats && (
            <div
              className="topbar-stats"
              aria-label="Library stats"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "var(--text-tertiary)",
                marginRight: "14px",
                whiteSpace: "nowrap",
              }}
            >
              <span>Library:</span>
              <strong style={{ color: "var(--text-secondary)" }}>
                {Number(
                  libraryStats.totalCount ??
                    libraryStats.total ??
                    libraryStats.count ??
                    0
                ).toLocaleString()}
              </strong>
              {Boolean(
                libraryStats.totalSizeBytes ||
                  libraryStats.totalBytes ||
                  libraryStats.sizeBytes
              ) && (
                <span>
                  (
                  {formatBytes(
                    Number(
                      libraryStats.totalSizeBytes ??
                        libraryStats.totalBytes ??
                        libraryStats.sizeBytes ??
                        0
                    )
                  )}
                  )
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            className="theme-toggle-btn"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            style={{
              height: "32px",
              padding: "0 10px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              marginRight: "12px",
              cursor: "pointer",
              borderRadius: "6px",
              border: "1px solid var(--bg-muted)",
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
            }}
          >
            {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
          </button>

          <label className="sort-label">
            <span className="muted">Sort:</span>
            <select
              className="select-input"
              value={sort}
              aria-label="Sort assets"
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* Segmented Filter Bar */}
      <div className="filters-strip">
        <div className="filters-group" role="group" aria-label="Filter by status">
          <span className="filters-heading">Status:</span>
          {STATUSES.map((s) => {
            const isChecked = status.includes(s);
            return (
              <button
                type="button"
                key={s}
                className={`filter-chip ${isChecked ? "filter-chip--active" : ""} filter-chip--${s}`}
                aria-pressed={isChecked}
                onClick={() =>
                  setStatus((prev) =>
                    isChecked ? prev.filter((x) => x !== s) : [...prev, s],
                  )
                }
              >
                <span className="filter-chip__indicator" aria-hidden="true" />
                <span>{statusLabel(s)}</span>
              </button>
            );
          })}
        </div>

        <div className="filters-summary">
          <span className="results-count">
            {loading ? (
              <span className="spinner-inline">Updating...</span>
            ) : (
              <>
                <strong>{items.length.toLocaleString()}</strong> of{" "}
                {total.toLocaleString()} assets
              </>
            )}
          </span>
        </div>
      </div>

      {isOffline && (
        <div
          role="status"
          style={{
            background: "#424242",
            color: "#fff",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13.5px",
          }}
        >
          <span>
            ⚠️ <strong>You are offline.</strong> Changes cannot be saved until
            connectivity is restored.
          </span>
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

          {retryableFailedIds.length > 0 && pendingStatus && !isOffline && (
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

          {undoPlan && !isOffline && (
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
        <div className="error-banner">
          <strong>Error:</strong> {getHumanErrorMessage(error)}
          <button onClick={() => refetch()} style={{ marginLeft: "12px" }}>
            Try again
          </button>
        </div>
      )}

      {/* Floating High-Contrast Bulk Bar */}
      {selectedIds.size > 0 && (
        <div className="bulkbar-floating" role="toolbar" aria-label="Bulk actions">
          <div className="bulkbar-count">
            <span className="bulkbar-badge">{selectedIds.size}</span>
            <span>selected</span>
          </div>

          <div className="bulkbar-divider" />

          {selectedIds.size < items.length && (
            <button className="btn-secondary" onClick={handleSelectAllLoaded}>
              Select all loaded ({items.length.toLocaleString()})
            </button>
          )}

          <button className="btn-secondary" onClick={handleClearSelection}>
            Clear
          </button>

          <div className="bulkbar-divider" />

          <div className="bulkbar-status-actions">
            <span className="bulkbar-action-label">Set status:</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`btn-status-action btn-status--${s}`}
                onClick={() => handleBulkStatus(s)}
              >
                {statusLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}

      <main className={`content ${loading ? "content-pending" : ""}`}>
        <ErrorBoundary
          fallbackTitle="Unable to display the asset gallery."
          onReset={() => refetch()}
        >
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
              onOpen={handleOpenDetail}
              hasNextPage={Boolean(nextCursor)}
              isFetchingNextPage={loadingMore}
              onLoadMore={loadMore}
              focusedIndex={focusedIndex}
              setFocusedIndex={setFocusedIndex}
            />
          )}
        </ErrorBoundary>

        {activeId && (
          <ErrorBoundary
            fallbackTitle="Failed to load asset details."
            onReset={handleCloseDetail}
          >
            <AssetDetail
              id={activeId}
              onClose={handleCloseDetail}
              onSaved={handleSaved}
            />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}