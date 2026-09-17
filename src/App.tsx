import { useState, useEffect, useCallback, useRef } from "react";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { useAssets } from "@/features/assets/useAssets";
import { statusLabel } from "@/lib/format";
import type { Asset, AssetStatus, AssetQuery } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];
const SORTS: Array<{ value: NonNullable<AssetQuery["sort"]>; label: string }> =
  [
    { value: "updatedAt:desc", label: "Recently updated" },
    { value: "name:asc", label: "Name A–Z" },
    { value: "sizeBytes:desc", label: "Largest first" },
    { value: "createdAt:desc", label: "Newest" },
  ];

// Read initial state from URL query parameters (Task 1)
// In src/App.tsx
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

  // Controlled search input value (updates on every stroke for immediate input response)
  const [searchInput, setSearchInput] = useState(initial.q);

  // Debounced search query (sent to network and URL)
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [kind, setKind] = useState<AssetQuery["kind"]>(initial.kind); // <-- Added
  const [tag, setTag] = useState<string[]>(initial.tag); // <-- Added

  // Active filters and sort state
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [sort, setSort] = useState<NonNullable<AssetQuery["sort"]>>(
    initial.sort,
  );
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);

  // Selection & UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  // Debounce timing rationale for SUBMISSION.md:
  // 300ms accounts for human typing rhythm (~150-200ms between keys) while leaving a safe
  // buffer so fast typers don't burn through the API's 80 req / 10s rolling rate limit.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync state to the browser URL using replaceState (avoids cluttering back/forward history)
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
  }, [debouncedQ, status, sort, activeId]);

  // Handle browser back / forward navigation
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

  // Fetch pipeline with cancellation, de-duplication, and cursor reset
  const { items, total, loading, error, refetch, mutateAssetLocal } = useAssets(
    {
      q: debouncedQ,
      status,
      kind,
      tag,
      sort,
    },
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleSaved(updatedAsset: Asset) {
    mutateAssetLocal(updatedAsset.id, updatedAsset);
    setNotice(`Saved "${updatedAsset.name}".`);
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

      {notice && <p className="notice">{notice}</p>}

      {/* Distinction between Error, Empty, and Loading states (Task 1) */}
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
