export type AssetStatus = 'draft' | 'in_review' | 'approved' | 'archived';
export type AssetKind = 'image' | 'video' | 'document';

export interface Owner {
  id: string;
  name: string;
}

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  tags: string[];
  collectionId: string;
  owner: Owner;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  hasThumbnail: boolean;
}

export interface AssetPage {
  items: Asset[];
  total: number;
  nextCursor: string | null;
}

export interface AssetQuery {
  q?: string;
  status?: AssetStatus[];
  kind?: AssetKind[];
  tag?: string[];
  collectionId?: string;
  owner?: string;
  sort?: 'updatedAt:desc' | 'updatedAt:asc' | 'name:asc' | 'name:desc' | 'sizeBytes:desc' | 'createdAt:desc';
  limit?: number;
  cursor?: string;
}

export interface BulkResult {
  results: Array<
    | { id: string; ok: true; asset: Asset }
    | { id: string; ok: false; code: string; message?: string }
  >;
  applied: number;
  failed: number;
}


export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;

  constructor(status: number, message: string, code = 'unknown_error', retryAfterSec: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }

  // Structural checks required by Task 4: Never retry 400, 409, 422
  get isRetryable(): boolean {
    if ([400, 404, 409, 422].includes(this.status)) return false;
    return this.status === 429 || this.status === 503 || this.status >= 500;
  }
}
