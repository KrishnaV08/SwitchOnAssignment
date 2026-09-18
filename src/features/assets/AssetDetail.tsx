import { useEffect, useState } from 'react';
import { getAsset, thumbnailUrl, updateAsset } from '@/api/client';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import { ApiError, type Asset, type AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

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

  useEffect(() => {
    setAsset(null);
    setError(null);
    setConflict(null);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Load failed'));
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
          // Fetch latest server record to expose the exact divergence
          const latest = await getAsset(asset.id);
          setConflict({
            attemptedStatus: status,
            serverAsset: latest,
          });
        } catch {
          setError('Version conflict detected, but failed to fetch latest asset state.');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  // Conflict Action 1: Discard local attempt and accept server state
  function handleAcceptServer() {
    if (!conflict) return;
    setAsset(conflict.serverAsset);
    onSaved(conflict.serverAsset);
    setConflict(null);
  }

  // Conflict Action 2: Force write using freshest version token
  function handleForceApply() {
    if (!conflict) return;
    setStatus(conflict.attemptedStatus, conflict.serverAsset.version);
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button onClick={onClose}>Close</button>
      </div>

      {error && <p className="error">{error}</p>}

      {conflict && (
        <div
          role="alert"
          style={{
            margin: '12px 16px',
            padding: '12px',
            background: '#fff3e0',
            border: '1px solid #ffb74d',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <strong style={{ color: '#e65100', display: 'block', marginBottom: '6px' }}>
            Version Conflict (409)
          </strong>
          <p style={{ margin: '0 0 10px 0', lineHeight: 1.4 }}>
            Another reviewer or process updated this asset. Server is at{' '}
            <strong>v{conflict.serverAsset.version}</strong> (
            <span className={`pill pill--${conflict.serverAsset.status}`}>
              {statusLabel(conflict.serverAsset.status)}
            </span>
            ), while your edit attempted{' '}
            <span className={`pill pill--${conflict.attemptedStatus}`}>
              {statusLabel(conflict.attemptedStatus)}
            </span>
            .
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleAcceptServer}
              style={{
                padding: '4px 10px',
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Accept server version
            </button>
            <button
              onClick={handleForceApply}
              style={{
                padding: '4px 10px',
                background: '#e65100',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Overwrite
            </button>
          </div>
        </div>
      )}

      {!asset && !error && <p className="muted">Loading…</p>}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
