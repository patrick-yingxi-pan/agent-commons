# P2 · Context & the filesystem sources

> **Pillar.** The three filesystem sources (UI host / runner / cloud) at production
> scale — real permissions, large/binary files, the upload pipeline, listing at scale,
> watching/invalidation. Builds on [F4](F4-broker-runners.md) (runner fs),
> [F6](F6-persistence-ops.md) (object storage). Serves spec CTX-1..5, CTX-FS-1..7.

## 1. Problem & scope

This is the subsystem just built in the prototype (`contract/fs.ts`, `server/fs.ts`,
`src/lib/uiHostFs.ts`, `src/lib/fsSources.ts`): files/photos/folders served for real
from three sources via `/fs/*?source=`. The reader is synchronous one-level scan over a
sample tree. Production scales each source, makes the upload seam real, and adds
listing-at-scale + change invalidation. **Shared** model; the *backing* of each source
differs by deployment.

## 2. Design

### 2.1 The three sources at scale

- **UI host ("This computer").** *Web:* the browser File System Access API / `<input>`
  (`uiHostFs.ts`) — bytes live client-side until an effect needs them, then upload to
  object storage (F6) via a **resumable, chunked** PUT keyed by content digest (the
  seam `uiHostFs.ts` already notes). *Desktop:* "This computer" is the **co-located
  runner** reading the real local fs (F4 fast path), not the browser — so desktop gets
  full local access while web stays sandboxed to what the user picks. Permissions =
  browser grant (web) / OS access via the sidecar (desktop).
- **Runner host.** `fs.list`/`fs.read` over the broker (F4); permission = the runner's
  advertised **scopes** (D3). Listing a large directory is **cursor-paginated** over
  `readdir`; binary/image content streams through the **broker bytes route** (already
  designed); a runner can push **change events** (a file/dir changed) which become SSE
  invalidations (F3) so an open catalog refreshes.
- **Cloud storage.** Backed by a **per-tenant object-storage prefix** (F6 PD29). Listing
  = object-store `list` (paginated, "folders" are key prefixes); content = **signed
  URLs** (`<img src>` for images, direct fetch for text); uploads = **direct-to-store**
  signed PUT (bytes skip the API). Available on both backends (the only source on a
  bare remote server, as today).

### 2.2 Catalog & content at scale

The prototype's `fsReader.list()` reads one level synchronously and returns everything;
production:

- **Pagination** — catalogs return a page + cursor (F3 PD14); huge dirs stream/cap.
- **Caching + invalidation** — catalog listings are cached and invalidated by watch
  events (runner) / object-store notifications (cloud); the advisory-event model (F3
  PD16) makes this a refetch, not a diff.
- **Traversal safety preserved** — id = source-relative path, resolved-under-root guard
  (already in `server/fs.ts`); the client never sends absolute paths.
- **Content rendering** — text via the content endpoint; images via signed URL/bytes
  route; large/binary via download or a typed viewer. The hand-authored artifact-content
  library (spec MOCK-2) is replaced by **real extraction/rendering** of the attached
  file (cross-ref [P5](P5-model-tools.md) for model-assisted summarization/preview).

### 2.3 Provenance & mediation (tightening a latent gap)

`SessionContext.source` already records which source a context came from. Production
sets `SessionContext.scope` to the **source-rooted path** so effect mediation (F4 PD22,
D5) matches the runner's advertised host grant exactly — closing the prototype's note
that a bare relative scope wouldn't line up with a `~/projects/...` target. A folder
attach authorizes effects within its rooted subtree; a single-file attach authorizes
just that path.

### 2.4 Indexing & search (forward)

Optional per-source content index (runner-side index; cloud via the object store's
search or a derived index) to power "find in attached context" — derived, rebuildable,
not system-of-record.

## 3. Failure modes & edge cases

- **Huge directory** — pagination + a hard cap with a "truncated, refine" signal (no
  silent truncation, per the project's no-silent-caps rule).
- **File changed/deleted after listing** — watch invalidation; a stale id 404s and the
  UI degrades gracefully (the `PhotoThumb` gradient fallback already does this).
- **Permission revoked** (runner scope narrowed, browser grant lost) — the source drops
  from the switcher (F3 invalidation); in-flight reads fail closed.
- **Upload failure / huge file** — resumable upload retries; an over-limit file is
  refused with a clear message; partial uploads are GC'd by lifecycle (F6).
- **Binary too large to preview** — the reader's size cap already returns a notice;
  offer download instead.

## 4. Security & multi-tenancy

Per-source authz: runner scopes (D3) + broker mediation (F4 PD22); cloud = per-tenant
prefix + time-scoped signed URLs; UI-host = browser grant / desktop OS access. No path
leak (resolved-under-root). Content crossing the broker is auditable (F4 §2.5). Uploaded
UI-host bytes inherit the tenant's encryption (F6).

## 5. Observability & ops

Per-source catalog latency + cache hit ratio; bytes served (and via which route);
upload success/resume rate; watch-event → invalidation lag; per-tenant storage usage
(cloud) for quota/billing.

## 6. Open questions & decisions

See [`DECISIONS.md`](DECISIONS.md): **PD38** (UI-host = browser fs on web / co-located
runner on desktop; effect-time resumable upload to object storage), **PD39** (runner fs
paginated + watch-driven SSE invalidation), **PD40** (cloud source = per-tenant
object-storage prefix, signed URLs, direct-to-store uploads), **PD41** (catalogs
paginated + cached + traversal-guarded; `SessionContext.scope` = source-rooted so
mediation matches the host grant), **PD42** (real content extraction/rendering replaces
the MOCK-2 artifact-content fixture library).
