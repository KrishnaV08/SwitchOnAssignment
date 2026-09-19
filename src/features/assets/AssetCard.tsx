import React, { useState, forwardRef } from "react";

import { thumbnailUrl } from "@/api/client";
import { formatBytes, formatDate, statusLabel } from "@/lib/format";
import type { Asset } from "@/lib/types";

interface AssetCardProps {
  asset: Asset;
  isSelected: boolean;
  isActive: boolean;
  tabIndex: number;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  onCardFocus: () => void;
}

export const AssetCard = React.memo(
  forwardRef<HTMLDivElement, AssetCardProps>(function AssetCard(
    {
      asset,
      isSelected,
      isActive,
      tabIndex,
      onToggleSelect,
      onOpen,
      onCardFocus,
    },
    ref,
  ) {
    const [imgFailed, setImgFailed] = useState(!asset.hasThumbnail);

    const handleCardClick = (e: React.MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        onToggleSelect(asset.id, true);
        return;
      }

      onOpen(asset.id);
    };

    const handleCheckClick = (e: React.MouseEvent<HTMLInputElement>) => {
      e.stopPropagation();
      onToggleSelect(asset.id, e.shiftKey);
    };

    const accessibleLabel = `${asset.name}, ${asset.kind}, ${statusLabel(
      asset.status,
    )}, ${isSelected ? "selected" : "not selected"}`;

    return (
      <div
        ref={ref}
        className={
          "card" +
          (isSelected ? " card--selected" : "") +
          (isActive ? " card--active" : "")
        }
        onClick={handleCardClick}
        onFocus={onCardFocus}
        role="gridcell"
        tabIndex={tabIndex}
        aria-selected={isSelected}
        aria-label={accessibleLabel}
        data-asset-id={asset.id}
      >
        {/* Visual card content.
            The gridcell itself already provides the accessible
            name, so don't expose these elements separately. */}
        <div className="card__thumb-wrapper" aria-hidden="true">
          {!imgFailed ? (
            <img
              className="card__thumb"
              src={thumbnailUrl(asset.id)}
              alt=""
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="card__thumb-fallback" aria-hidden="true">
              <span className="card__thumb-fallback-kind">{asset.kind}</span>
            </div>
          )}
        </div>

        <div className="card__body" aria-hidden="true">
          <p className="card__name" title={asset.name}>
            {asset.name}
          </p>

          <p className="muted">
            {asset.kind} · {formatBytes(asset.sizeBytes)} ·{" "}
            {formatDate(asset.updatedAt)}
          </p>

          <span className={`pill pill--${asset.status}`}>
            {statusLabel(asset.status)}
          </span>
        </div>

        <input
          type="checkbox"
          className="card__check"
          checked={isSelected}
          tabIndex={-1}
          aria-hidden="true"
          onClick={handleCheckClick}
          onChange={() => {}}
        />
      </div>
    );
  }),
);
