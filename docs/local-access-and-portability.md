# Local-resource access & portability — a design exploration

> **Status: exploration, not a locked-in decision.** This is a design log, not a
> spec. It captures a line of reasoning to pick up later. The decisions that *are*
> settled live in [`../AGENTS.md`](../AGENTS.md) → "Design decisions (locked in)";
> nothing here overrides them, and the current code still works exactly as those
> docs describe. Read this as "where the architecture could go," not "what it is."

## The question that started it

The prototype ships one UI over a portable backend, and the docs describe two
deployments — a **native desktop** (UI in an app shell over a local sidecar) and a
**web app** (same UI served by a remote web server). The original framing tied a
set of *capabilities* (`localFs`, `localGit`, `osPicker`) to **where the backend
runs**: native = can reach local resources, remote = can't (returns
`409 capability_unavailable`).

Working through it, that framing turned out to be **wrong in an instructive way**,
and unwinding it points at a cleaner, more unified architecture. This note records
the chain of corrections and the open questions they leave.

## Recap: the three components

| Component | One-line identity (the project's own framing) |
|---|---|
| **UI** (`src/`) | A *cache of the backend*. Reads through hooks; never knows a URL or holds a key. |
| **App backend** (`server/`) | A *client of the model*. Owns app-domain state (sessions, projects, artifacts, relations) and holds the API credential. |
| **Model server** (`server/model/` → `api.anthropic.com`) | The LLM provider. Remote in *every* scenario; the mock (`:8788`) is only its dev stand-in. |

The exploration below is almost entirely about the **first two** — specifically,
about where "local resources" enter the system and who is allowed to know about
deployment differences.

## Insight 1 — capabilities are **not** a local-vs-remote property

A remote backend can serve every "native" concept here: a filesystem, a git
working tree, a diff, even a live terminal. **GitHub Codespaces, Gitpod, and
WebContainers are existence proofs** — a browser UI talking to a *remote* backend
that provisions a container and exposes exactly these affordances over the wire.
Nothing in the contract (`/fs/folders/:id`, `/git/repos/:id/diff`) says "must be
local"; the `409` that `BACKEND=remote` returns is a property of *that one mock
remote implementation*, not of remoteness.

So the real axis is **not** "local vs remote backend." It is: *does this particular
backend instance provision/offer this resource?* — which varies with cost, plan
tier, and security posture, orthogonal to where the server runs.

The current code already half-knows this:
[`store.ts:126`](../server/store.ts) marks `scheduledExecution: true` even for a
remote backend ("a remote server can run schedules too"), while keeping
`localFs`/`localGit`/`osPicker` tied to `NATIVE`. The flag names
([`api.ts:19`](../contract/api.ts)) bake in the local assumption this insight
overturns — `localFs`/`localGit` are mis-framed; only `osPicker` (the *user's own*
OS dialog) is legitimately device-bound (see Insight 4's residue).

## Insight 2 — the UI is itself a local-access bridge

The deeper correction: you never needed a *local backend* to reach local files,
because **the UI runs on the device.** Local access is properly a **client**
capability, present in both shells, differing only in reach:

- **Browser tab:** the File System Access API (`showDirectoryPicker`,
  `showOpenFilePicker`, writable handles) lets a page read *and* write a chosen
  directory and persist the handle across sessions; plus `<input type=file>` and
  drag-drop. All **user-gesture-initiated and permission-prompted** — never silent
  arbitrary-path access — and the directory/writable parts are **Chromium-only**
  (Safari/Firefox fall back to file-input + drag-drop, read-only).
- **Electron renderer:** Chromium, so all of the above *plus* (via preload/IPC to
  Node) unrestricted paths, real `git` as a process, a live PTY, FS watching. The
  privileged superset.

So "browser can't touch local resources" is false; it touches *less*, through a
sandbox, but it touches them.

## The refined rule — feature-detect *self*, read *backend* from the backend

This sharpens (does not break) the project's "never sniff Electron-vs-web" rule
([`api.ts:15`](../contract/api.ts)). Two genuinely different questions:

- *"What can my own runtime do?"* — Is the File System Access API present? Am I a
  privileged Electron renderer? The UI **may and must** feature-detect this; it's a
  fact about the UI's own powers.
- *"What is the backend, and what does it offer?"* — The UI must **never** infer
  this from its environment; it reads backend-owned facts from the backend
  (`GET /v1/capabilities`, or just the shape of the resources served).

**Feature-detect self; read backend from the backend.** That single line resolves
the whole "should a pure view know about capabilities" tension: knowing your *own*
client reach is not deployment-sniffing; inferring the *backend's* nature would be.

## Insight 3 — ingestion is a **write path**; upload creates a replica

If the UI reads local bytes and sends them onward, "frontend is a cache of the
backend" still holds — provided local ingestion is modeled as a **write/command,
not a read**:

1. The UI reads local bytes via its client APIs → **transient client state** (like
   an unsent composer draft; the one accepted exception to cache-of-backend).
2. The UI **uploads** them via a command.
3. Thereafter the resource is **backend-owned**, and the UI is a cache of it again.
4. Transfers up *and* down are just more user-issued commands.

Two consequences that are the actual hard part:

- **Upload creates a second replica.** The still-changing local original and the
  cloud snapshot diverge the instant after upload. "Share across all of a user's UI
  instances" then falls out for free *for the cloud copy* (once backend-owned, every
  instance caches it identically) — but keeping it reconciled with the moving local
  replica is the **Dropbox/Codespaces problem**: source-of-truth + conflict
  resolution, not access. This is why user-directed transfer/sync must be
  **first-class**, not incidental.

## Insight 4 — the only irreducible residue: the **live machine**

Sending the *files* is not access to the *environment*. "Run my repo's tests with
my installed toolchain, my env vars, a real PTY, in place" is device **execution** —
the browser sandbox can't do it; only native/Electron-with-Node (or an on-device
agent) can. The cloud can run the *uploaded copy* in *its* container, but that's the
cloud's environment, not the user's.

So the irreducible local/remote distinction narrows precisely to **executing against
the user's actual machine** — *not* to accessing local files, which the UI can do
anywhere. `osPicker` ([`api.ts:31`](../contract/api.ts)) — the user's *own* OS
dialog — is the one current flag that legitimately sits here.

## Insight 5 — the promising direction: a localhost companion unifies the scenarios

A browser page can reach a **pre-installed native helper** by two mechanisms:

1. **Protocol-handler deep link** (to *launch* it): the app registers a URI scheme
   (`vscode://`, `slack://`, a `web+...` handler); the page opens it; the OS launches
   the app with a consent prompt. One-shot signaling; you can't reliably even detect
   whether it's installed (timeout heuristics only).
2. **Loopback companion server** (to *talk to* it): the helper runs an HTTP/WS server
   on `127.0.0.1:<port>`; the page `fetch`/`WebSocket`s it. (Ledger bridge, Docker
   Desktop, Figma, old Spotify Web.) **This is the one that erases the scenario
   difference** — the page now reaches a fully-native backend over the *same*
   HTTP+SSE contract it uses for the cloud.

Which gives the clean reframing:

> **Electron is not a different architecture — it's a browser with the local helper
> pre-bundled and auto-launched.** Browser + separately-installed companion is the
> same topology with the bundling unbundled. There is really only *one*
> architecture — UI ⇄ backend over HTTP+SSE, where the backend may be a local one on
> loopback — and "Electron vs web" was only ever *how the local backend gets
> installed and started.*

**The repo already expresses this.** [`server/index.ts`](../server/index.ts) binds
`127.0.0.1`; [`respond.ts:20`](../server/http/respond.ts) sets permissive
`CORS_HEADERS` (its own comment anticipates "a native host ... may hit the server
cross-origin"); and the UI reaches the backend through a swappable base —
[`client.ts:11`](../src/api/client.ts), `VITE_API_BASE ?? /api/v1`, with the comment
"a packaged desktop app injects an absolute `http://127.0.0.1:<port>`." A "localhost
companion" deployment is literally `server/index.ts` running as an installed
background agent with the browser UI pointed at it. The contract doesn't change.

### What the difference becomes (it moves, it doesn't vanish)

With the companion pattern the *capability* difference disappears, but new
**lifecycle/trust** concerns appear that Electron gives you for free:

- **Presence & liveness.** The helper is separately installed and may not be
  running. The UI needs one runtime check — the legitimate kind: probe
  `127.0.0.1:<port>`, and on failure show "Install / launch the desktop helper"
  instead of a local-repo panel. The "two scenarios" difference is demoted from
  *what can the backend do* to *is my helper up*, answered by probing with graceful
  onboarding.
- **Browser local-network gating (a moving target).** `https` → `http://127.0.0.1`
  is currently allowed (localhost is a secure-context exception), but Chrome's
  **Private Network Access / Local Network Access** rollout adds preflights and a
  permission prompt for public sites reaching loopback. This pattern is getting
  *more* gated over time — design around it.
- **Origin trust on the loopback.** *Any* web origin in the browser can try to hit
  `127.0.0.1:<port>`. The helper must authenticate the caller (pairing token, origin
  allowlist) — an attack surface Electron's process-private IPC doesn't have.
- **Version skew.** The cloud-served UI is always latest; the installed helper
  updates on its own cadence. They can drift, so the UI↔helper handshake needs
  contract/version negotiation. (This is the *first genuinely useful* role for the
  capability descriptor — as helper-compatibility negotiation, not deployment
  sniffing.)

## Open design forks (to resolve when we pick this up)

1. **Helper as backend, or helper as ingestion device?**
   - *As backend:* the UI talks to the local helper as its one API; the helper also
     fronts/relays the cloud. Keeps a single base URL, but splits source-of-truth.
   - *As ingestion device:* the cloud backend stays the single read-source the UI
     caches (per Insight 3's "ingest = write path"); the helper is purely a local
     *write arm* that pushes local resources up. Cleaner cache story; the UI may then
     talk to two endpoints (cloud read, local write) and must coordinate them.
2. **Sync / source-of-truth model** for the local↔cloud replicas: one-way upload
   snapshots, manual two-way transfer, or continuous bi-directional sync with
   conflict resolution? What does the contract for "instruct a transfer" look like?
3. **Discovery & pairing** for the loopback helper: fixed port vs. port range probe
   vs. a well-known local registry file; first-run pairing token; how the cloud UI
   learns the helper's port.
4. **Capability descriptor, reframed.** If capabilities stop meaning "is the backend
   local," do they survive as (a) helper version/compat negotiation, (b) an
   "offerable but unprovisioned here" hint so the UI shows disabled/upsell instead of
   nothing, or (c) pure resource-shape data with no separate descriptor? Possible
   follow-on: rename `localFs`/`localGit` to affordance-named flags decoupled from
   "local" (touches the load-bearing `contract/` — propose, don't just do).
5. **The execution residue (Insight 4).** Decide explicitly what *must* run on the
   user's machine (live toolchain, real PTY, in-place tests) vs. what runs on an
   uploaded copy in a cloud container — i.e., where the on-device helper is
   load-bearing rather than a convenience.

## If we pick this up — suggested first steps

- Sketch the contract delta for **local ingestion as a command** (the write path)
  and a **transfer/sync** resource, without breaking existing reads.
- Prototype the **loopback-companion** path: run `server/index.ts` as a standalone
  helper, point a browser build at it via `VITE_API_BASE`, and add a **presence
  probe + onboarding fallback** in the UI. This validates "Electron = unbundled
  companion" on the real code with the smallest change.
- Add **origin auth** to the loopback server and confirm behavior under Chrome's
  Private Network Access preflight before relying on the pattern.
