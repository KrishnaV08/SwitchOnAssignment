import { useEffect, useState, useRef } from "react";
import { getAsset, thumbnailUrl, updateAsset } from "@/api/client";
import {
  formatBytes,
  formatDate,
  formatDuration,
  statusLabel,
} from "@/lib/format";
import { ApiError, type Asset, type AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

interface ConflictState {
  attemptedStatus: AssetStatus;
  serverAsset: Asset;
}

export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Close panel on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setAsset(null);
    setError(null);
    setConflict(null);
    setImgFailed(false);

    getAsset(id)
      .then((data) => {
        setAsset(data);
        setImgFailed(!data.hasThumbnail);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load asset details."),
      );
  }, [id]);

  async function setStatus(status: AssetStatus, targetVersion?: number) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setConflict(null);

    const versionToSubmit = targetVersion ?? asset.version;

    try {
      const updated = await updateAsset(asset.id, versionToSubmit, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const latest = await getAsset(asset.id);
          setConflict({
            attemptedStatus: status,
            serverAsset: latest,
          });
        } catch {
          setError(
            "Version conflict detected, but failed to fetch latest asset state.",
          );
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to save asset status.");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAcceptServer() {
    if (!conflict) return;
    setAsset(conflict.serverAsset);
    onSaved(conflict.serverAsset);
    setConflict(null);
  }

  function handleForceApply() {
    if (!conflict) return;
    setStatus(conflict.attemptedStatus, conflict.serverAsset.version);
  }

  return (
    <aside
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-detail-title"
    >
      <div className="panel__head">
        <div className="panel__head-left">
          <span className="panel__eyebrow">Inspector</span>
          <h2 id="asset-detail-title" className="panel__title">Asset Detail</h2>
        </div>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="panel__close-btn"
          aria-label="Close detail panel (Esc)"
          title="Close (Esc)"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="panel__alert panel__alert--danger" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {conflict && (
        <div className="panel__conflict-card" role="alert">
          <div className="panel__conflict-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <strong>Version Conflict (409)</strong>
          </div>
          <p className="panel__conflict-desc">
            Another reviewer modified this file. Server is currently at{" "}
            <strong>v{conflict.serverAsset.version}</strong> (
            <span className={`pill pill--${conflict.serverAsset.status}`}>
              {statusLabel(conflict.serverAsset.status)}
            </span>
            ), conflicting with your intended status{" "}
            <span className={`pill pill--${conflict.attemptedStatus}`}>
              {statusLabel(conflict.attemptedStatus)}
            </span>
            .
          </p>
          <div className="panel__conflict-actions">
            <button
              onClick={handleAcceptServer}
              className="panel__conflict-btn panel__conflict-btn--secondary"
            >
              Accept server
            </button>
            <button
              onClick={handleForceApply}
              className="panel__conflict-btn panel__conflict-btn--primary"
            >
              Overwrite
            </button>
          </div>
        </div>
      )}

      {!asset && !error && (
        <div className="panel__loading" role="status">
          <div className="panel__loading-spinner" aria-hidden="true" />
          <span>Loading asset details...</span>
        </div>
      )}

      {asset && (
        <div className="panel__body">
          {/* Media Preview Box */}
          <div className="panel__thumb-wrapper">
            {!imgFailed ? (
              <img
                className="panel__thumb"
                src={thumbnailUrl(asset.id)}
                alt=""
                aria-hidden="true"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div className="panel__thumb-fallback" aria-hidden="true">
                <svg
                  className="panel__thumb-fallback-icon"
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <div className="panel__thumb-fallback-meta">
                  <span className="panel__thumb-fallback-kind">{asset.kind}</span>
                  <span className="panel__thumb-fallback-label">No preview file</span>
                </div>
              </div>
            )}
          </div>

          {/* Title & Current Status Badge */}
          <div className="panel__summary-header">
            <div className="panel__summary-row">
              <span className={`pill pill--${asset.status}`}>
                {statusLabel(asset.status)}
              </span>
              <span className="panel__version-tag">v{asset.version}</span>
            </div>
            <h3 className="panel__name" title={asset.name}>{asset.name}</h3>
          </div>

          {/* Status Progression Control */}
          <div className="panel__section">
            <div className="panel__section-header">
              <span className="panel__section-label">Set Status</span>
              {saving && <span className="panel__status-saving">Saving...</span>}
            </div>
            <div className="panel__status-picker" role="group" aria-label="Asset review status">
              {STATUSES.map((statusOption) => {
                const isCurrent = statusOption === asset.status;
                return (
                  <button
                    key={statusOption}
                    type="button"
                    disabled={saving || isCurrent}
                    aria-pressed={isCurrent}
                    onClick={() => setStatus(statusOption)}
                    className={`panel__status-btn panel__status-btn--${statusOption} ${
                      isCurrent ? "panel__status-btn--current" : ""
                    }`}
                  >
                    <span className="panel__status-dot" aria-hidden="true" />
                    <span>{statusLabel(statusOption)}</span>
                    {isCurrent && (
                      <svg className="panel__status-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Structured Attributes Section */}
          <div className="panel__section">
            <span className="panel__section-label">File Metadata</span>
            <div className="panel__facts-card">
              <div className="panel__fact-row">
                <span className="panel__fact-key">Identifier</span>
                <code className="panel__fact-val-code">{asset.id}</code>
              </div>
              <div className="panel__fact-row">
                <span className="panel__fact-key">Media Kind</span>
                <span className="panel__fact-val" style={{ textTransform: "capitalize" }}>{asset.kind}</span>
              </div>
              <div className="panel__fact-row">
                <span className="panel__fact-key">File Size</span>
                <span className="panel__fact-val">{formatBytes(asset.sizeBytes)}</span>
              </div>
              {asset.width && asset.height && (
                <div className="panel__fact-row">
                  <span className="panel__fact-key">Dimensions</span>
                  <span className="panel__fact-val">{asset.width} × {asset.height} px</span>
                </div>
              )}
              {asset.durationSec && (
                <div className="panel__fact-row">
                  <span className="panel__fact-key">Duration</span>
                  <span className="panel__fact-val">{formatDuration(asset.durationSec)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Audit Section */}
          <div className="panel__section">
            <span className="panel__section-label">Audit & Ownership</span>
            <div className="panel__facts-card">
              <div className="panel__fact-row">
                <span className="panel__fact-key">Owner</span>
                <span className="panel__fact-val">{asset.owner.name}</span>
              </div>
              <div className="panel__fact-row">
                <span className="panel__fact-key">Updated</span>
                <span className="panel__fact-val">{formatDate(asset.updatedAt)}</span>
              </div>
            </div>
          </div>

          {/* Tags */}
          {asset.tags.length > 0 && (
            <div className="panel__section">
              <span className="panel__section-label">Tags</span>
              <ul className="panel__tags" aria-label="Asset tags">
                {asset.tags.map((tag) => (
                  <li key={tag} className="panel__tag-item">
                    #{tag}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}