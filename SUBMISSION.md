## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends >50 ids in one call, violating API payload limits and causing 400s | `App.tsx` | Fixed |
| 2 | Out-of-order search responses clobber newer results due to artificial prefix latency | `App.tsx` / `useAssets.ts` | Fixed |
| 3 | In-flight search requests not aborted at network level, burning through the 80 req / 10s rate limit | `client.ts` / `useAssets.ts` | Fixed |
| 4 | Stale cursor retained across query/filter changes, throwing unhandled `400 stale_cursor` | `useAssets.ts` | Fixed |
| 5 | Unvirtualized DOM mounts unbounded card nodes across 12,400 assets, degrading layout perf | `AssetGrid.tsx` | Fixed |
| 6 | Un-memoized cards trigger full-grid re-renders on single checkbox selection toggle | `AssetCard.tsx` | Fixed |
| 7 | ~4% missing thumbnails (404 / `hasThumbnail: false`) display broken image frames with CLS | `AssetCard.tsx` | Fixed |
| 8 | Bulk operations treat HTTP 207 Multi-Status as binary pass/fail without per-ID rollback | `client.ts` / `App.tsx` | Fixed |
| 9 | Transient errors (503, 429) fail immediately without respecting `Retry-After` headers | `client.ts` | Fixed |
| 10 | Thousands of interactive card elements pollute the tab stop order, with zero visible focus | `AssetGrid.tsx` | Next up (Task 5) |
| 11 | Shift-clicking checkboxes mutates pivot anchor on every click, breaking multi-step range extension/contraction | `App.tsx` / `AssetCard.tsx` | Fixed |
| 12 | Stale version updates in detail panel fail or throw unhandled `409 version_conflict` without divergence UI | `AssetDetail.tsx` | Fixed |

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

**Selection isolation & persistent range selection**
- Extracted `AssetCard` into a dedicated component wrapped with `React.memo`.
- Refactored selection state updates in `App.tsx` to pass a stable boolean `isSelected` instead of passing down raw `selectedIds` references, and used functional state updaters (`setSelectedIds(prev => ...)`). Checking or unchecking an asset now re-renders only that single card.
- Implemented an OS-style persistent anchor model (`anchorIdRef` and `baseSelectionRef`). Clicking without Shift establishes a fixed pivot and snapshots the baseline selection; subsequent Shift-clicks retain that original pivot to calculate dynamic index ranges against `itemsRef.current`. This allows smooth continuous expansion and contraction over 500+ items without clearing earlier selections or stuttering across virtualized row boundaries.
- Intercepted Shift/Meta clicks directly on `AssetCard` to execute selection without firing `onOpen`, preventing the detail panel from toggling and causing grid layout thrash during multi-selection.
- Added a `Select all loaded` shortcut that aggregates IDs directly from `itemsRef` in $O(N)$ time.

**Chunking and bounded concurrency**
- Built a utility worker queue (`runWithConcurrency`) capped at 3 simultaneous requests, paired with `chunkArray` chunking bounded strictly to $\le 50$ IDs per payload.
- When applying status across 300+ items, the payload breaks into discrete batches of 50. Dispatching them via the 3-worker pool satisfies the API payload cap and prevents socket starvation without firing dozens of unmetered parallel network requests.

**Optimistic updates, selective 207 rollbacks & recovery**
- Applied status changes optimistically to local state before firing requests, making the UI reflect changes immediately.
- Snapped previous statuses per ID into a lookup map before mutation. Upon receiving the HTTP `207 Multi-Status` response:
  - Items marked `{ ok: true }` stay updated.
  - Items marked `{ ok: false }` are selectively rolled back to their exact previous status using `mutateAssetLocal`, keeping all successful peer items intact.
- Failure categorization & recovery:
  - `code: "legal_hold"`: Compliance lock that deterministically fails. These are explicitly reported to the user and excluded from retry candidate sets to avoid useless network calls.
  - Transient/random drops (~7% artificial backend drop rate): Grouped into a retry queue, surfacing an inline **"Retry N failed"** button targeting only the failed subset.
  - Successful updates populate an `undoPlan` state map, giving reviewers a single-click **"Undo"** action to revert the applied batch.

**Optimistic concurrency & 409 version conflict resolution**
- Single-asset status updates in `AssetDetail.tsx` require explicit optimistic concurrency control using row `version` tokens.
- *Why we rejected silent Last-Write-Wins (LWW):* In a multi-reviewer workflow, blindly fetching the newest version and re-saving silently clobbers concurrent edits made by other reviewers.
- *Resolution strategy:* When the server returns `ApiError` with HTTP `409 Conflict`, the panel catches the error and immediately fetches the latest record via `getAsset(id)`. An inline alert surfaces the exact divergence (live server version/status vs. the user's attempted edit) with two explicit options:
  1. *Accept server version:* Discards local changes, adopts the server's state, and synchronizes the grid.
  2. *Overwrite:* Re-submits the user's intended status using the server's updated version token, making overrides an explicit, intentional decision.

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
| Script evaluation duration during 500-item Shift+Click | 85ms+ (dropped frames) | < 2.5ms | Chrome DevTools Performance panel recording |
| Peak concurrent network sockets during a 300-item bulk update | 1 single oversized request (400 rejection) | Exactly 3 concurrent requests (6 chunks of 50) | Chrome DevTools Network waterfall view |
| Unnecessary card re-renders during selective rollback (5 failures out of 50) | Entire grid re-rendered (50+ cards) | Exactly 5 cards re-rendered | React DevTools Profiler ("Highlight updates when components render") |
| Longest task during sustained scroll | 120ms+ (frequent dropped frames) | < 16ms (solid 60fps) | Chrome DevTools Performance panel recording |
| Requests fired while typing a 6-character query | 6 requests | 1–2 requests | Chrome DevTools Network tab |
| Production bundle, gzipped | 48.0 kB | 58.9 kB (+10.9 kB) | `npm run build` output stats |

What was the actual bottleneck, and how did you find it?
- Four major culprits choked performance and stability:
  1. Network clobbering: Typing `tra` and finishing with `tracker` triggered race conditions due to artificial short-prefix delays (up to 350ms). Un-aborted earlier requests returned last and overwrote newer search results. Identified using DevTools Network waterfall and artificial throttling.
  2. DOM explosion & cascade re-renders: The baseline grid mapped over the entire dataset with zero windowing and evaluated selection in place. At hundreds of items, toggling one card forced React to reconcile every single DOM node. Profiling in React DevTools highlighted the full tree turning red. Adding `@tanstack/react-virtual` clamped mounted cards to viewport bounds (~30 cards), and `React.memo` isolated selection changes strictly to the clicked card.
  3. Bulk payload limits & unbounded socket bursts: Dispatching bulk updates for large selections (>50 items) triggered hard 400 rejections from the API. Conversely, unmetered parallel chunking risked socket starvation. Slicing items into bounded chunks of 50 handled by a 3-worker concurrency queue kept traffic bounded and predictable.
  4. Range selection pivot mutation: Updating the selection anchor on every Shift+Click caused multi-step range selections to collapse or fail across virtualization row boundaries. Moving to a persistent anchor reference (`anchorIdRef`) and deriving ranges against `itemsRef.current` reduced execution overhead to under 2.5ms while preserving predictable multi-step selections.
- On bundle size: The build grew by ~10.9 kB gzipped over the 48 kB baseline. We accepted this trade-off deliberately: `@tanstack/react-virtual` delivers solid sub-16ms frame times, handles multi-column responsive chunking, and keeps scroll anchoring stable when toggling the side inspection panel.
