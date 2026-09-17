import type { Asset, AssetPage, AssetQuery, BulkResult } from "@/lib/types";
import { ApiError } from "@/lib/types";

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status?.length)
    params.set("status", query.status.slice().sort().join(","));
  if (query.kind?.length)
    params.set("kind", query.kind.slice().sort().join(","));
  if (query.tag?.length) params.set("tag", query.tag.slice().sort().join(","));
  if (query.collectionId) params.set("collectionId", query.collectionId);
  if (query.owner) params.set("owner", query.owner);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(createAbortError());
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(createAbortError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.message.toLowerCase().includes("abort") ||
      err.message.toLowerCase().includes("canceled")
    );
  }
  return false;
}

interface RequestOptions extends RequestInit {
  maxRetries?: number;
}

// Map key -> { promise, subscribers: Set<AbortController> }
interface InFlightEntry<T> {
  promise: Promise<T>;
  subscribers: number;
  internalAbort: AbortController;
}
const inFlightRequests = new Map<string, InFlightEntry<unknown>>();

async function executeFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { maxRetries = 3, signal, ...init } = options;
  let attempt = 0;

  while (true) {
    // 1. Guard check before doing work
    if (signal?.aborted) {
      throw createAbortError();
    }

    try {
      const res = await fetch(path, {
        ...init,
        signal,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });

      if (!res.ok) {
        let code = "http_error";
        let message = res.statusText;

        try {
          const body = await res.json();
          if (body?.error) {
            code = body.error.code ?? code;
            message = body.error.message ?? message;
          }
        } catch {
          /* response was not JSON */
        }

        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader
          ? parseInt(retryAfterHeader, 10)
          : null;

        const apiError = new ApiError(res.status, message, code, retryAfterSec);

        // Task 4: Retry transient read failures (503, 429) unless aborted
        if (apiError.isRetryable && attempt < maxRetries && !signal?.aborted) {
          attempt++;
          const baseDelayMs = retryAfterSec
            ? retryAfterSec * 1000
            : Math.pow(2, attempt) * 200;
          const jitterMs = Math.random() * 150;
          await sleep(baseDelayMs + jitterMs, signal);
          continue;
        }

        throw apiError;
      }

      return (await res.json()) as T;
    } catch (err) {
      // 2. Never retry cancellations
      if (isAbortError(err) || signal?.aborted) {
        throw createAbortError();
      }

      // Retry network-level drops if attempts remain and we were NOT aborted
      if (
        err instanceof TypeError &&
        attempt < maxRetries &&
        !signal?.aborted
      ) {
        attempt++;
        await sleep(Math.pow(2, attempt) * 200 + Math.random() * 150, signal);
        continue;
      }

      throw err;
    }
  }
}

/**
 * Request dispatcher with both de-duplication AND per-caller abort capability (Task 1).
 */
export function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const isGet = !options.method || options.method === "GET";

  if (!isGet) {
    return executeFetch<T>(path, options);
  }

  // De-duplicate concurrent identical GET requests
  let entry = inFlightRequests.get(path) as InFlightEntry<T> | undefined;

  if (!entry) {
    const internalAbort = new AbortController();
    const fetchPromise = executeFetch<T>(path, {
      ...options,
      signal: internalAbort.signal,
    }).finally(() => {
      inFlightRequests.delete(path);
    });

    entry = {
      promise: fetchPromise,
      subscribers: 0,
      internalAbort,
    };
    inFlightRequests.set(path, entry as InFlightEntry<unknown>);
  }

  entry.subscribers++;

  // Wrap the shared promise so that if THIS caller's signal aborts,
  // we decrement subscribers, abort the underlying network call if nobody is left,
  // and reject only this caller without breaking others.
  return new Promise<T>((resolve, reject) => {
    const currentEntry = entry!;
    const signal = options.signal ?? undefined;

    function onAbort() {
      currentEntry.subscribers--;
      if (currentEntry.subscribers <= 0) {
        currentEntry.internalAbort.abort();
        inFlightRequests.delete(path);
      }
      reject(createAbortError());
    }

    if (signal?.aborted) {
      return onAbort();
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    currentEntry.promise
      .then((data) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(data);
      })
      .catch((err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
  });
}

export function listAssets(
  query: AssetQuery,
  signal?: AbortSignal,
): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal });
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  return request(`/api/assets/batch?ids=${ids.join(",")}`, { signal });
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, "name" | "status" | "tags">>,
  signal?: AbortSignal,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ version, patch }),
    signal,
    maxRetries: 2,
  });
}

export function bulkSetStatus(
  ids: string[],
  status: Asset["status"],
  signal?: AbortSignal,
): Promise<BulkResult> {
  return request<BulkResult>("/api/assets/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
    signal,
    maxRetries: 2,
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
