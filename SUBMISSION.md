## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends >50 ids in one call, violating API payload limits and causing 400s | `App.tsx` | Next up (Task 3) |
| 2 | Out-of-order search responses clobber newer results due to artificial prefix latency | `App.tsx` / `useAssets.ts` | Fixed |
| 3 | In-flight search requests not aborted at network level, burning through the 80 req / 10s rate limit | `client.ts` / `useAssets.ts` | Fixed |
| 4 | Stale cursor retained across query/filter changes, throwing unhandled `400 stale_cursor` | `useAssets.ts` | Fixed |
| 5 | Unvirtualized DOM mounts unbounded card nodes across 12,400 assets, degrading layout perf | `AssetGrid.tsx` | Next up (Task 2) |
| 6 | Un-memoized cards trigger full-grid re-renders on single checkbox selection toggle | `AssetCard.tsx` | Next up (Task 2) |
| 7 | ~4% missing thumbnails (404 / `hasThumbnail: false`) display broken image frames with CLS | `AssetCard.tsx` | Next up (Task 2) |
| 8 | Bulk operations treat HTTP 207 Multi-Status as binary pass/fail without per-ID rollback | `client.ts` / `App.tsx` | Next up (Task 3) |
| 9 | Transient errors (503, 429) fail immediately without respecting `Retry-After` headers | `client.ts` | Fixed |
| 10 | Thousands of interactive card elements pollute the tab stop order, with zero visible focus | `AssetGrid.tsx` | Next up (Task 5) |

---

## Key decisions

**Data fetching and caching**
- Built an in-flight request de-duplication registry in `client.ts`. Identical concurrent `GET` requests share an active promise rather than opening parallel network sockets.
- Rejected external client caches (like React Query or SWR) for now to keep runtime weight near zero and make our abort signals and cursor state transitions explicit.

**Stale response handling**
- Paired a 300ms debounce with an isolated `AbortController` per fetch run. 
- The 300ms interval fits normal typing pauses (~180–220ms per key) while protecting the backend's rolling 80 req / 10s budget. 
- The moment a new debounced value hits, the previous controller aborts the socket immediately (`0.0 kB (canceled)` in DevTools). If a late response slips through before cancellation settles, `controller.signal.aborted` checks prevent it from updating state.

**State placement and URL sync**
- Pushed `q`, `status`, `kind`, `tag`, and `sort` directly to the URL using `window.history.replaceState`. 
- Rejected `pushState` for filtering because it pollutes browser history with every character typed. `replaceState` gives deep link shareability on reload without breaking the Back button.

**Retry and backoff policy**
- Implemented an `ApiError` class distinguishing retryable transient errors (`503`, `429`, dropped connections) from deterministic ones (`400`, `404`, `409`, `422`).
- Retries obey the `Retry-After` response header, with fallback to exponential backoff and random jitter ($2^n \times 200\text{ms} + \text{jitter}$). Crucially, retries bail immediately if the request was aborted by the user.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.
*Tested on MacBook Air (M-series), Brave/Chromium.*

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | — | — | Benchmarking in Task 2 |
| Cards re-rendered when toggling one selection | — | — | Benchmarking in Task 2 |
| Longest task during sustained scroll | — | — | Benchmarking in Task 2 |
| Requests fired while typing a 6-character query | 6 requests | 1–2 requests | Chrome DevTools Network Tab |
| Production bundle, gzipped | — | — | Benchmarking post-build |

What was the actual bottleneck, and how did you find it?
- The primary network bottleneck was the combination of artificial delay on short prefixes (up to 350ms) and no request cancellation. Typing `tra` and finishing with `tracker` reliably returned `tra` last, clobbering the correct search results. Found using DevTools Network waterfall and throttling.
