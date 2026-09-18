import { useRef, useMemo, useEffect, useState, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Asset } from '@/lib/types';
import { AssetCard } from './AssetCard';

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}

const CARD_MIN_WIDTH = 220;
const GAP = 12;
const ESTIMATED_ROW_HEIGHT = 280;

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);

  // Observe container width changes (survives detail panel toggle)
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    // Set initial width immediately
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
    return Math.max(1, Math.floor((containerWidth - 32 + GAP) / (CARD_MIN_WIDTH + GAP)));
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
    overscan: 4,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Primary trigger: IntersectionObserver on a sentinel placed right at the end of the scroll list
  useEffect(() => {
    const root = parentRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasNextPage || isFetchingNextPage || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root,
        rootMargin: '400px', // Preload when user is within 400px of bottom
        threshold: 0,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore, rows.length]);

  // Fallback trigger: On scroll in virtualizer
  useEffect(() => {
    if (!virtualItems.length || !hasNextPage || isFetchingNextPage || !onLoadMore) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= rows.length - 2) {
      onLoadMore();
    }
  }, [virtualItems, rows.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="grid-scroller">
      <div
        className="grid-virtual-container"
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const rowAssets = rows[virtualRow.index];
          if (!rowAssets) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="grid-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GAP}px`,
                padding: '0 16px',
              }}
            >
              {rowAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={selectedIds.has(asset.id)}
                  isActive={activeId === asset.id}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Sentinel element to continuously trip next-page cursor fetches */}
      <div ref={sentinelRef} style={{ height: '40px', width: '100%', pointerEvents: 'none' }} />

      {isFetchingNextPage && (
        <div className="grid-loading-indicator muted">
          Loading more assets…
        </div>
      )}
    </div>
  );
}
