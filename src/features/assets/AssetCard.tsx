import React, { useState } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface AssetCardProps {
  asset: Asset;
  isSelected: boolean;
  isActive: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

export const AssetCard = React.memo(function AssetCard({
  asset,
  isSelected,
  isActive,
  onToggleSelect,
  onOpen,
}: AssetCardProps) {
  const [imgFailed, setImgFailed] = useState(!asset.hasThumbnail);

  return (
    <div
      className={
        'card' +
        (isSelected ? ' card--selected' : '') +
        (isActive ? ' card--active' : '')
      }
      onClick={() => onOpen(asset.id)}
      role="article"
      aria-selected={isSelected}
    >
      <div className="card__thumb-wrapper">
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

      <div className="card__body">
        <p className="card__name" title={asset.name}>
          {asset.name}
        </p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>

      <input
        type="checkbox"
        className="card__check"
        checked={isSelected}
        aria-label={`Select ${asset.name}`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
      />
    </div>
  );
});
