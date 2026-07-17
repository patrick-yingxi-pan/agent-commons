/** ── The draft-session controller (universal split Phase 6) ──────────────────
 *  The ONE funnel that turns the unsaved draft into a real, persisted session
 *  on first send — extracted from the singleton controller's handleSend so any
 *  host (the singleton surface today, a ConversationPane hosting the draft
 *  after the primary dissolves) drives the identical flow: no fork, one
 *  behavior. Pure and dependency-injected on purpose (the conversationCore
 *  pattern): the api calls and the panel-pref write are passed into the
 *  factory, so tests/draft-core.test.ts locks the coalesced materialization,
 *  the flush-before-send ordering, the late model-pick write, and the focus
 *  carry without a DOM or a fetch.
 *
 *  What the funnel owns (module state per controller):
 *  - `materializing` — the in-flight createSession, so a rapid second send on
 *    the same fresh draft COALESCES into one session (the composer stays live
 *    while streaming).
 *  - `pendingContexts` — contexts attached to the draft before first send (a
 *    FWD-1 seed or a manual attach): a draft can't persist bindings (no server
 *    id), so they buffer here and FLUSH onto the real session before the turn
 *    streams (generation derives an attached connector's tools from the
 *    session's server-side contexts — the message must not race the bindings).
 *  What stays with the host: the draft's model-pick STATE (the composer
 *  renders it), handed in via `getPick` so the funnel reads dispatch-time and
 *  post-materialize values without owning the state. */
import type { Session } from '../../contract/index'
import type { AddedContext, PanelFocus } from '../types'
import type { ModelPick } from '../lib/models'
// Extension-qualified: this module is node-tested (tests/draft-core.test.ts),
// and Node's native TS resolves runtime imports only with the explicit .ts.
import {
  addContextToLive,
  bindingsFor,
  focusForAdded,
  focusValidIn,
  removeContextsFromLive,
  removeFolderFromLive,
  repoIdForLabel,
  slug,
  workspaceOf,
  DRAFT_ID,
  EMPTY_LIVE,
  type Live,
} from '../data/liveSession.ts'

/** What the draft funnel needs from the outside world — the api commands in
 *  the app, a fake in tests. */
export interface DraftDeps {
  createSession: (firstMessage: string, providerId?: string, modelId?: string) => Promise<Session>
  attachContext: (sessionId: string, binding: ReturnType<typeof bindingsFor>[number]) => Promise<unknown>
  persistWorkspace: (sessionId: string, workspace: ReturnType<typeof workspaceOf>) => Promise<unknown>
  patchSession: (sessionId: string, patch: { providerId: string; modelId: string }) => Promise<unknown>
  /** FWD-2: remember the draft's panel choice on the real session. */
  setPanelPref: (sessionId: string, focus: PanelFocus | null) => void
  /** The live provider registry (peek(keys.providers)) — undefined = not loaded. */
  knownProviders: () => Array<{ id: string; models?: Array<{ id: string }> }> | undefined
  /** The inherit-default provider id the sanitize resolves an unset pick against. */
  defaultProviderId: string
  /** The keyed conversation store — the slice the funnel drives. */
  store: {
    get: (id: string) => { live: Live; focus: PanelFocus | null }
    adopt: (from: string, to: string) => void
    sendTurn: (id: string, text: string) => Promise<void>
    reset: (id: string, live: Live) => void
    setLive: (id: string, live: Live) => void
    setFocus: (id: string, f: PanelFocus | null) => void
  }
}

export type DraftController = ReturnType<typeof createDraftController>

export function createDraftController(deps: DraftDeps) {
  /** The in-flight materialization (null = none) — the coalesce handle. */
  let materializing: Promise<Session> | null = null
  /** Contexts attached to the draft before first send, awaiting the flush. */
  let pendingContexts: AddedContext[] = []

  /** A stale pick — a deleted provider, a model its catalog dropped — degrades
   *  to the inherit default instead of failing the materialization (the server
   *  404s an unknown providerId, 400s an off-catalog modelId). */
  const sanitizePick = (pick: ModelPick): ModelPick => {
    const known = deps.knownProviders()
    if (!known) return pick // registry not loaded — let the server arbitrate
    const provider = known.find((p) => p.id === (pick.providerId ?? deps.defaultProviderId))
    if (pick.providerId && !provider) return {}
    const modelId = pick.modelId && provider?.models?.some((m) => m.id === pick.modelId) ? pick.modelId : undefined
    return { providerId: pick.providerId, modelId }
  }

  /** Buffer a context attached to the draft (no server id to bind against yet);
   *  flushed onto the real session by the first send. */
  const bufferContext = (ctx: AddedContext): void => {
    pendingContexts.push(ctx)
  }

  /** Abandon the staged buffer (navigating away from the draft) — a context
   *  staged on a LEFT draft must not flush onto a different session's first
   *  send (the FWD-1 pending buffer rule). */
  const clearBuffer = (): void => {
    pendingContexts = []
  }

  /** A COMPOSER attach on the draft: always STACKS — optimistic live + panel
   *  open + the FWD-1 buffer — and NEVER resets the entry. Resetting is a
   *  launcher semantic (addSeed / New session); reaching a reset from the
   *  composer would wipe an in-progress draft thread (e.g. the degraded send
   *  that streams against the draft when the server is unreachable). */
  const attach = (ctx: AddedContext): void => {
    const next = addContextToLive(deps.store.get(DRAFT_ID).live, ctx)
    deps.store.setLive(DRAFT_ID, next)
    deps.store.setFocus(DRAFT_ID, focusForAdded(ctx, next))
    pendingContexts.push(ctx)
  }

  /** Drop a buffered seed that no longer contributes to the draft's live —
   *  the FWD-1 buffer mirrors every remove, or a removed chip's seed would
   *  silently RE-ATTACH to the materialized session on first send. */
  const purgeBuffer = (keep: (ctx: AddedContext) => AddedContext | null): void => {
    pendingContexts = pendingContexts.map(keep).filter((c): c is AddedContext => c !== null)
  }

  /** Clear the draft's panel if it pointed at what a remove just dropped. */
  const reconcileFocus = (next: Live): void => {
    const focus = deps.store.get(DRAFT_ID).focus
    if (focus && !focusValidIn(next, focus)) deps.store.setFocus(DRAFT_ID, null)
  }

  /** Remove attached contexts from the draft (the composer's chip remove) —
   *  optimistic live + buffer purge + dangling-panel clear; no server writes
   *  (a draft has no row — the real-session funnel's detach/persist would
   *  just 404). */
  const removeContexts = (focuses: PanelFocus[]): void => {
    const ids = (kind: PanelFocus['kind']) => new Set(focuses.filter((f) => f.kind === kind).map((f) => f.id))
    const wsIds = ids('workspace')
    const repoIds = ids('repo')
    const connIds = ids('connector')
    const attIds = new Set([...ids('file'), ...ids('photo')])
    const next = removeContextsFromLive(deps.store.get(DRAFT_ID).live, focuses)
    deps.store.setLive(DRAFT_ID, next)
    purgeBuffer((ctx) => {
      if (ctx.kind === 'folder') return wsIds.size ? null : ctx // the one shared workspace dropped ⇒ every folder seed goes
      if (ctx.kind === 'repo') return repoIds.has(repoIdForLabel(ctx.label)) ? null : ctx
      if (ctx.kind === 'connector' || ctx.kind === 'mcp') return connIds.has(ctx.connector.id) ? null : ctx
      if (ctx.kind === 'files' || ctx.kind === 'photos') {
        const left = ctx.attachments.filter((a) => !attIds.has(a.id))
        return left.length ? { ...ctx, attachments: left } : null
      }
      return ctx
    })
    reconcileFocus(next)
  }

  /** Remove one source folder from the draft's shared workspace (and its seed). */
  const removeFolder = (sourceId: string): void => {
    const next = removeFolderFromLive(deps.store.get(DRAFT_ID).live, sourceId)
    deps.store.setLive(DRAFT_ID, next)
    purgeBuffer((ctx) =>
      ctx.kind === 'folder' && (ctx.artifacts[0]?.source?.id ?? slug(ctx.label)) === sourceId ? null : ctx,
    )
    reconcileFocus(next)
  }

  /** The FWD-1 launcher's multi-add rule: on an already-fresh EMPTY draft the
   *  context STACKS (several picks build ONE new thread — attach + buffer +
   *  panel), anything else starts a fresh seeded draft. */
  const addSeed = (ctx: AddedContext): void => {
    const entry = deps.store.get(DRAFT_ID)
    if (entry.live.messages.length === 0 && (entry.live.repos.length || entry.live.workspaces.length || entry.live.connectors.length || entry.live.attachments.length)) {
      attach(ctx)
    } else {
      reset(ctx)
    }
  }

  /** Start a fresh draft (New session): blank or pre-seeded with one context
   *  (FWD-1 entry shortcuts) — the seed's panel opens (focusForAdded), the
   *  same auto-open a manual attach gets. Resets the coalesce handle so the
   *  next send re-materializes rather than reusing the previous draft's
   *  session. */
  const reset = (seed?: AddedContext): void => {
    materializing = null
    if (seed) {
      const seeded = addContextToLive(EMPTY_LIVE, seed)
      deps.store.reset(DRAFT_ID, seeded)
      deps.store.setFocus(DRAFT_ID, focusForAdded(seed, seeded))
      pendingContexts = [seed]
    } else {
      deps.store.reset(DRAFT_ID, EMPTY_LIVE)
      deps.store.setFocus(DRAFT_ID, null)
      pendingContexts = []
    }
  }

  /** The whole draft send: materialize (coalesced) → flush seeds → carry focus
   *  → flush a late model pick → adopt the entry → stream the turn. The HOST
   *  appends the optimistic user turn + flags before calling (its writes may
   *  target the draft entry `adopt` then moves) and learns the real id via
   *  `onAdopted` (the singleton re-points activeId; a pane rewrites its leaf).
   *  Falls back to streaming against the draft id when the server is
   *  unreachable (graceful degradation — the reply renders, just unpersisted). */
  const sendDraftTurn = async (
    text: string,
    getPick: () => ModelPick,
    onSession?: (s: Session) => void,
    onAdopted?: (realId: string) => void,
  ): Promise<void> => {
    // Dispatch-time captures (synchronous, before any await): the panel choice
    // (now store-held, per-session) and the sanitized model pick.
    const draftFocus = deps.store.get(DRAFT_ID).focus
    const draftModel = sanitizePick(getPick())
    let sid: string = DRAFT_ID
    try {
      const pending = materializing ?? deps.createSession(text, draftModel.providerId, draftModel.modelId)
      materializing = pending
      const created = await pending
      sid = created.id
      onSession?.(created)
      // Flush the pre-attached contexts BEFORE the turn streams: generation
      // derives an attached connector/MCP's tools from the session's
      // server-side contexts (P6), so the bindings must land first. Panels are
      // derived from the SAME seeds (not a live read — a mid-flight navigation
      // could have replaced the live state), keeping binding-of-record and
      // panels in lock-step.
      const seeded = pendingContexts
      if (seeded.length) {
        await Promise.all(seeded.flatMap((ctx) => bindingsFor(ctx).map((b) => deps.attachContext(sid, b).catch(() => {}))))
        const seededLive = seeded.reduce((l, ctx) => addContextToLive(l, ctx), EMPTY_LIVE)
        void deps.persistWorkspace(sid, workspaceOf(seededLive)).catch(() => {})
        pendingContexts = []
      }
      // Carry the draft's panel choice onto the real session (FWD-2): the
      // draft couldn't persist a pref (no server id), so an explicitly-closed
      // panel would otherwise be re-opened by strongestFocus on reopen.
      deps.setPanelPref(sid, draftFocus)
      // A model pick changed WHILE materializing went to the draft slot after
      // the capture above — flush it, sanitized the same way (a stale pref the
      // dispatch dropped must not re-PATCH and 404 every fresh-draft send).
      const latePick = sanitizePick(getPick())
      if (latePick.providerId !== draftModel.providerId || latePick.modelId !== draftModel.modelId) {
        void deps.patchSession(sid, { providerId: latePick.providerId ?? '', modelId: latePick.modelId ?? '' })
      }
      // The draft entry's optimistic state (user turn(s), flags, focus) moves
      // under the real id — once; a coalesced second send finds the slot blank
      // and adopt() skips it.
      deps.store.adopt(DRAFT_ID, sid)
      onAdopted?.(sid)
    } catch {
      // Couldn't materialize (server unreachable) — stream against the draft
      // id; the reply still renders, it just isn't persisted.
      materializing = null // let a retry re-materialize
      sid = DRAFT_ID
    }
    await deps.store.sendTurn(sid, text)
  }

  return { addSeed, attach, removeContexts, removeFolder, bufferContext, clearBuffer, reset, sendDraftTurn, sanitizePick }
}
