# 05 · Portable contract & push-based sync

> **Intent.** The same UI must run unchanged against two backends — a native desktop
> sidecar and a remote web server — so the desktop/web drift disappears *by
> construction*. The mechanism is a single framework-free **contract** imported
> verbatim by both ends (the shared types *are* the API), a small read-through cache
> fed by one SSE stream for push-based sync, and `GET /v1/capabilities` + `409
> capability_unavailable` so native-only features gate on flags, never on sniffing
> Electron vs web. (PROPOSAL §10; README "Architecture".)

## Requirements (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| PORT-1 | The contract is framework- and Node-free and imported verbatim by both the UI and the server (type-identity = the portability guarantee). | `contract/index.ts`, `contract/entities.ts`, `contract/api.ts` | `tests/contract-boundaries.test.ts` | ✅ |
| PORT-2 | One versioned HTTP + SSE surface; the UI resolves a single base URL (`VITE_API_BASE ?? /api/v1`) and nothing else in the UI knows a URL. | `API_BASE_PATH` in `contract/api.ts`, `src/api/client.ts`, `src/api/keys.ts` | `tests/contract-boundaries.test.ts`; in-app (`src/api/client.ts`) | ✅ |
| PORT-3 | `GET /v1/capabilities` declares what this backend can do; the UI gates native-only affordances on those flags, never on env detection. | `Capabilities` in `contract/api.ts`, `server/store.ts`, `src/api/hooks.ts` | `tests/capabilities.test.ts` | ✅ |
| PORT-4 | Native-only endpoints (`/fs/pick`, `/fs/folders/:id`, `/git/repos/:id/diff`) return `409 capability_unavailable` on a remote backend; the served `/fs/*?source=cloud` works on both. | `server/routes/index.ts`, `server/store.ts` | `tests/capability-remote.test.ts` | ✅ |
| PORT-5 | Reads go through a read-through cache; the server pushes unrequested changes over one SSE stream and an event router turns each into a cache patch. | `src/api/cache.ts`, `src/api/events.ts`, `server/http/sse.ts`, `ServerEvent` in `contract/events.ts` | `tests/contract-boundaries.test.ts` | ✅ |
| PORT-6 | Every declared `ServerEvent` has a server producer **and** a client consumer; every `*Request` DTO is wired into a route. | `contract/events.ts`, `src/api/events.ts`, `server/routes/index.ts` | `tests/contract-boundaries.test.ts` | ✅ |
| PORT-7 | The conversation is server-owned: the backend mints session/message ids and the client adopts them (no client-fabricated persisted ids). | `contract/ids.ts`, `src/api/ids.ts`, `server/store.ts` | `tests/optimistic-id.test.ts` | ✅ |
