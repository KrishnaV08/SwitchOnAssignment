import { useEffect, useState, useCallback } from "react";
import { listAssets, isAbortError } from "@/api/client";
import type { Asset, AssetQuery } from "@/lib/types";
import { ApiError } from "@/lib/types";

interface UseAssetsOptions {
  q: string;
  status: AssetQuery["status"];
  kind?: AssetQuery["kind"];
  tag?: string[];
  sort: AssetQuery["sort"];
  limit?: number;
}

export function useAssets({ q, status, kind, tag, sort, limit = 24 }: UseAssetsOptions) {
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Normalize array parameters to stable primitive strings for dependency tracking
  const statusKey = (status ?? []).slice().sort().join(",");
  const kindKey = (kind ?? []).slice().sort().join(",");
  const tagKey = (tag ?? []).slice().sort().join(",");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    const query: AssetQuery = {
      q: q.trim() || undefined,
      status: status && status.length > 0 ? status : undefined,
      kind: kind && kind.length > 0 ? kind : undefined,
      tag: tag && tag.length > 0 ? tag : undefined,
      sort,
      limit,
      cursor: undefined, // Always reset cursor on query/filter mutations (Task 1)
    };

    listAssets(query, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems(page.items);
          setTotal(page.total);
          setNextCursor(page.nextCursor);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        // Silently swallow cancellations from unmounts or newer keystrokes
        if (isAbortError(err) || controller.signal.aborted) {
          return;
        }

        setLoading(false);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to fetch assets"
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [q, statusKey, kindKey, tagKey, sort, limit, reloadToken]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return;

    setLoadingMore(true);
    const query: AssetQuery = {
      q: q.trim() || undefined,
      status: status && status.length > 0 ? status : undefined,
      kind: kind && kind.length > 0 ? kind : undefined,
      tag: tag && tag.length > 0 ? tag : undefined,
      sort,
      limit,
      cursor: nextCursor,
    };

    listAssets(query)
      .then((page) => {
        setItems((prev) => [...prev, ...page.items]);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          setError(`Pagination error: ${err.message}`);
        } else {
          setError(err instanceof Error ? err.message : "Pagination failed");
        }
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [nextCursor, loading, loadingMore, q, statusKey, kindKey, tagKey, sort, limit]);

  const mutateAssetLocal = useCallback((id: string, patch: Partial<Asset>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const refetch = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  return {
    items,
    total,
    nextCursor,
    loading,
    loadingMore,
    error,
    loadMore,
    mutateAssetLocal,
    refetch,
  };
}
