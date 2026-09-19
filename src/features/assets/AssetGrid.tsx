import {
  useRef,
  useMemo,
  useEffect,
  useState,
  useLayoutEffect,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Asset } from "@/lib/types";
import { AssetCard } from "./AssetCard";

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  focusedIndex: number;
  setFocusedIndex: (idx: number | ((prev: number) => number)) => void;
}

const CARD_MIN_WIDTH = 220;
const GAP = 12;
const ESTIMATED_ROW_HEIGHT = 292;
const ROW_GAP = 12;
export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  focusedIndex,
  setFocusedIndex,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth - 32 : 1000,
  );

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = useMemo(() => {
    return Math.max(
      1,
      Math.floor((containerWidth - 32 + GAP) / (CARD_MIN_WIDTH + GAP)),
    );
  }, [containerWidth]);

  const rows = useMemo(() => {
    const result: Asset[][] = [];
    for (let i = 0; i < assets.length; i += columns) {
      result.push(assets.slice(i, i + columns));
    }
    return result;
  }, [assets, columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    gap: ROW_GAP,
    overscan: 4,
    getItemKey: (index) => rows[index]?.[0]?.id ?? index,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  // Guard against focus loss if filtering truncates the list
  useEffect(() => {
    if (assets.length > 0 && focusedIndex >= assets.length) {
      setFocusedIndex(assets.length - 1);
    }
  }, [assets.length, focusedIndex, setFocusedIndex]);

  // Sync scroll position when focused item changes via keyboard
  const scrollToFocused = useCallback(
    (index: number) => {
      const targetRow = Math.floor(index / columns);
      rowVirtualizer.scrollToIndex(targetRow, { align: "auto" });
      // Small timeout to allow DOM node to mount if jumping across virtual rows
      setTimeout(() => {
        const el = parentRef.current?.querySelector<HTMLElement>(
          `[data-asset-id="${assets[index]?.id}"]`,
        );
        el?.focus();
      }, 16);
    },
    [assets, columns, rowVirtualizer],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (assets.length === 0) return;

    let targetIndex = focusedIndex;
    let handled = false;

    switch (e.key) {
      case "ArrowRight":
        if (focusedIndex < assets.length - 1) {
          targetIndex = focusedIndex + 1;
          handled = true;
        }
        break;
      case "ArrowLeft":
        if (focusedIndex > 0) {
          targetIndex = focusedIndex - 1;
          handled = true;
        }
        break;
      case "ArrowDown":
        if (focusedIndex + columns < assets.length) {
          targetIndex = focusedIndex + columns;
          handled = true;
        }
        break;
      case "ArrowUp":
        if (focusedIndex - columns >= 0) {
          targetIndex = focusedIndex - columns;
          handled = true;
        }
        break;
      case "Enter": {
        const item = assets[focusedIndex];
        if (item) {
          onOpen(item.id);
          handled = true;
        }
        break;
      }
      case " ": {
        e.preventDefault();
        const item = assets[focusedIndex];
        if (item) {
          onToggleSelect(item.id, e.shiftKey);
          handled = true;
        }
        break;
      }
    }

    if (handled) {
      e.preventDefault();
      if (targetIndex !== focusedIndex) {
        setFocusedIndex(targetIndex);
        scrollToFocused(targetIndex);

        if (e.shiftKey) {
          const targetAsset = assets[targetIndex];
          if (targetAsset) {
            onToggleSelect(targetAsset.id, true);
          }
        }
      }
    }
  };

  // Primary trigger: IntersectionObserver on sentinel
  useEffect(() => {
    const root = parentRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasNextPage || isFetchingNextPage || !onLoadMore)
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root,
        rootMargin: "400px",
        threshold: 0,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore, rows.length]);

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">
          Clear the search box or widen the status filter.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="grid-scroller"
      role="grid"
      aria-label="Asset library"
      aria-rowcount={rows.length}
      aria-colcount={columns}
      onKeyDown={handleKeyDown}
    >
      <div
        className="grid-virtual-container"
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const rowAssets = rows[virtualRow.index];
          if (!rowAssets || rowAssets.length === 0) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="grid-row"
              role="row"
              aria-rowindex={virtualRow.index + 1}
              style={{
                position: "absolute",
                top: 10,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GAP}px`,
                padding: "0 16px",
              }}
            >
              {rowAssets.map((asset, colIndex) => {
                const globalIndex = virtualRow.index * columns + colIndex;
                const isRovingTarget = globalIndex === focusedIndex;

                return (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    isSelected={selectedIds.has(asset.id)}
                    isActive={activeId === asset.id}
                    tabIndex={isRovingTarget ? 0 : -1}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                    onCardFocus={() => setFocusedIndex(globalIndex)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div
        ref={sentinelRef}
        style={{ height: "40px", width: "100%", pointerEvents: "none" }}
      />

      {isFetchingNextPage && (
        <div className="grid-loading-indicator muted" role="status">
          Loading more assets…
        </div>
      )}
    </div>
  );
}
