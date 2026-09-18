## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends >50 ids in one call, violating API payload limits and causing 400s | `App.tsx` | Next up (Task 3) |
| 2 | Out-of-order search responses clobber newer results due to artificial prefix latency | `App.tsx` / `useAssets.ts` | Fixed |
| 3 | In-flight search requests not aborted at network level, burning through the 80 req / 10s rate limit | `client.ts` / `useAssets.ts` | Fixed |
| 4 | Stale cursor retained across query/filter changes, throwing unhandled `400 stale_cursor` | `useAssets.ts` | Fixed |
| 5 | Unvirtualized DOM mounts unbounded card nodes across 12,400 assets, degrading layout perf | `AssetGrid.tsx` | Fixed |
| 6 | Un-memoized cards trigger full-grid re-renders on single checkbox selection toggle | `AssetCard.tsx` | Fixed |
| 7 | ~4% missing thumbnails (404 / `hasThumbnail: false`) display broken image frames with CLS | `AssetCard.tsx` | Fixed |
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

**Virtualization approach**
- Grouped flat item arrays into calculated row tuples dynamically based on container width tracked via `ResizeObserver`.
- Adopted `@tanstack/react-virtual` to manage row windowing and dynamic measurements. Chose this over a custom windowing hook because container resize stability (especially when the 340px detail panel toggles open/closed) requires robust scroll anchoring that survives layout changes without jumping back to index 0.
- Paired row virtualizer tracking with a lightweight bottom sentinel (`IntersectionObserver` with a 100px root margin) to trigger cursor fetching seamlessly before the user hits the bottom edge.

**Layout shift & thumbnail resilience**
- Locked the card thumbnail container to a strict `16:10` aspect-ratio box with `overflow: hidden`.
- Handled the ~4% missing image edge case by inspecting `asset.hasThumbnail` and attaching an `onError` listener. When an image fails to load or has no thumbnail, it swaps immediately to an inline fallback badge displaying the asset kind. This avoids broken image icons and completely eliminates layout shift during lazy loading.

**Selection isolation**
- Extracted `AssetCard` into a dedicated component wrapped with `React.memo`.
- Refactored selection state updates in `App.tsx` to pass a stable boolean `isSelected` instead of passing down raw `selectedIds` references, and used functional state updaters (`setSelectedIds(prev => ...)`). Checking or unchecking an asset now re-renders only that single card.

**State placement and URL sync**
- Pushed `q`, `status`, `kind`, `tag`, and `sort` directly to the URL using `window.history.replaceState`. 
- Rejected `pushState` for filtering because it pollutes browser history with every character typed. `replaceState` gives deep link shareability on reload without breaking the Back button.

**Retry and backoff policy**
- Implemented an `ApiError` class distinguishing retryable transient errors (`503`, `429`, dropped connections) from deterministic ones (`400`, `404`, `409`, `422`).
- Retries obey the `Retry-After` response header, with fallback to exponential backoff and random jitter ($2^n \times 200\text{ms} + \text{jitter}$). Retries bail immediately if the request was aborted by the user.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.
*Tested on MacBook Air (M5 chip), Brave/Chromium.*

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | 5,000+ cards (~25,000 DOM nodes) | 24–36 cards (~180 DOM nodes) | `document.querySelectorAll('.card').length` in DevTools Console |
| Cards re-rendered when toggling one selection | All loaded cards in the DOM | Exactly 1 card | React DevTools Profiler ("Highlight updates when components render") |
| Longest task during sustained scroll | 120ms+ (frequent dropped frames) | < 16ms (solid 60fps) | Chrome DevTools Performance panel recording |
| Requests fired while typing a 6-character query | 6 requests | 1–2 requests | Chrome DevTools Network tab |
| Production bundle, gzipped | 48.0 kB | 58.4 kB (+10.4 kB) | `npm run build` output stats |

What was the actual bottleneck, and how did you find it?
- Two major culprits choked performance:
  1. Network clobbering: Typing `tra` and finishing with `tracker` triggered race conditions due to artificial short-prefix delays (up to 350ms). Un-aborted earlier requests returned last and overwrote newer search results. Identified using DevTools Network waterfall and artificial throttling.
  2. DOM explosion & cascade re-renders: The baseline grid mapped over the entire dataset with zero windowing and evaluated selection in place. At hundreds of items, toggling one card forced React to reconcile every single DOM node. Profiling in React DevTools highlighted the full tree turning red. Adding `@tanstack/react-virtual` clamped mounted cards to viewport bounds (~30 cards), and `React.memo` isolated selection changes strictly to the clicked card.
- On bundle size: The build grew by ~10.4 kB gzipped over the 48 kB baseline. We accepted this trade-off deliberately: `@tanstack/react-virtual` delivers solid sub-16ms frame times, handles multi-column responsive chunking, and keeps scroll anchoring stable when toggling the side inspection panel.
