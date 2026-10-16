/** ── The draft-session controller (universal split Phase 6) ──────────────────
 *  The ONE funnel that turns the unsaved draft into a real, persisted session
 *  on first send — extracted from the singleton controller's handleSend so any
 *  host (the singleton surface today, a ConversationPane hosting the draft
 *  after the primary dissolves) drives the identical flow: no fork, one
 *  behavior. Pure and dependency-injected on purpose (the conversationCore
 *  pattern): the api calls and the panel-pref write are passed into the
 *  factory, so src/controller/draft-core.test.ts locks the coalesced materialization,
 *  the flush-before-send ordering, the late model-pick write, and the focus
 *  carry without a DOM or a fetch.
 *
 *  What the funnel owns (module state per controller):
 *  - `materializing` + `materializationKey` — the in-flight createSession and
 *    its durable logical identity, so rapid sends coalesce and response-loss
 *    Retry returns the same persisted session (the composer stays live while
 *    streaming).
 *  - `pendingContexts` — contexts attached to the draft before first send (a
 *    FWD-1 seed or a manual attach): a draft can't persist bindings (no server
 *    id), so they buffer here and FLUSH onto the real session before the turn
 *    streams (generation derives an attached connector's tools from the
 *    session's server-side contexts — the message must not race the bindings).
 *  What stays with the host: the draft's model-pick STATE (the composer
 *  renders it), handed in via `getPick` so the funnel reads dispatch-time and
 *  post-materialize values without owning the state. */
import type { Session, SessionContextState, UpdateSessionContextStateRequest } from '../../contract/index'
import type { AddedContext, PanelFocus } from '../types'
import type { ConversationBinding } from '../lib/conversationBinding'
import { workspaceFolders } from '../../contract/workspaceFolders.ts'
// Extension-qualified: this module is node-tested (src/controller/draft-core.test.ts),
// and Node's native TS resolves runtime imports only with the explicit .ts.
import {
  addContextToLive,
  bindingsFor,
  bucketFocuses,
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
  createSession: (
    firstMessage: string,
    options: {
      agentId?: string
      providerId: string | undefined
      modelId: string | undefined
      idempotencyKey: string
      expectedSessionUserId?: string | null
      freezeSessionWriteSource?: true
    },
  ) => Promise<Session>
  updateContextState: (sessionId: string, request: UpdateSessionContextStateRequest, expectedSessionUserId?: string | null) => Promise<SessionContextState>
  /** Read once at send dispatch; materialization retries and context flush use the same source. */
  captureSessionWriteSourceUserId?: () => string | null | undefined
  /** Account switches retire every continuation, including abandoned drafts. */
  accountGeneration?: () => number
  patchSession: (sessionId: string, patch: { agentId?: string; providerId: string; modelId: string }) => Promise<unknown>
  /** FWD-2: remember the draft's panel choice on the real session. */
  setPanelPref: (sessionId: string, focus: PanelFocus | null, ready?: Promise<unknown>) => void
  /** The live provider registry (peek(keys.providers)) — undefined = not loaded. */
  knownProviders: () => Array<{ id: string; models?: Array<{ id: string }> }> | undefined
  knownAgents?: () => Array<{ id: string; providerId?: string }> | undefined
  /** The inherit-default provider id the sanitize resolves an unset pick against. */
  defaultProviderId: string
  /** The keyed conversation store — the slice the funnel drives. */
  store: {
    get: (id: string) => { live: Live; focus: PanelFocus | null }
    epoch: (id: string) => number
    adopt: (from: string, to: string) => void
    sendTurn: (id: string, text: string) => Promise<void>
    failPendingSend: (id: string, since: number, text: string, failure: string) => void
    reset: (id: string, live: Live) => void
    setLive: (id: string, live: Live) => void
    setFocus: (id: string, f: PanelFocus | null) => void
  }
}

export type DraftController = ReturnType<typeof createDraftController>

export function createDraftController(deps: DraftDeps) {
  /** The in-flight materialization (null = none) — the coalesce handle. */
  let materializing: Promise<Session> | null = null
  /** One key for the whole lifetime of this unsaved draft. A response may be
   * lost after the row commits; Retry must address that exact row, not mint a
   * second conversation. Reset is the only action that begins a new identity. */
  let materializationKey: string | null = null
  /** Contexts attached to the draft before first send, awaiting the flush. */
  let pendingContexts: AddedContext[] = []
  /** A context-state request can commit even when its acknowledgement is lost.
   * Keep the workspace reconciliation alive until a later acknowledgement. */
  let contextFlushUncertain = false
  /** Effect bindings named by unacknowledged attach requests. If removed before
   * retry, they still need an explicit detach. */
  const attemptedBindingIds = new Set<string>()
  /** Bumped by every `reset()` — a generation stamp captured at dispatch. If it
   *  moves across the materialization await, the draft the send began on was
   *  ABANDONED (New session, an FWD-1 seed launch, the root route) and its
   *  post-materialization steps must not fire against the NEW draft's live
   *  state (flushing its seeds onto the wrong session, adopting its entry away,
   *  retargeting the user's fresh pane). The turn still lands server-side. */
  let resetGen = 0

  /** A stale pick — a deleted provider, a model its catalog dropped — degrades
   *  to the inherit default instead of failing the materialization (the server
   *  404s an unknown providerId, 400s an off-catalog modelId). */
  const sanitizePick = (pick: ConversationBinding): ConversationBinding => {
    const known = deps.knownProviders()
    if (!known) return pick // registry not loaded — let the server arbitrate
    const agent = deps.knownAgents?.()?.find((candidate) => candidate.id === (pick.agentId ?? 'agent-default'))
    const provider = known.find((p) => p.id === (pick.providerId ?? agent?.providerId ?? deps.defaultProviderId))
    if (pick.providerId && !provider) return pick.agentId ? { agentId: pick.agentId } : {}
    const modelId = pick.modelId && provider?.models?.some((m) => m.id === pick.modelId) ? pick.modelId : undefined
    return { ...(pick.agentId ? { agentId: pick.agentId } : {}), providerId: pick.providerId, modelId }
  }

  /** Exact-key recovery may represent an earlier binding. Every dispatch path,
   * including an orphaned send, confirms its own intent before generation. */
  const confirmBinding = async (created: Session, pick: ConversationBinding): Promise<void> => {
    const agentId = pick.agentId ?? 'agent-default'
    const agentChanged = agentId !== (created.agentId ?? 'agent-default')
    if (agentChanged || pick.providerId !== created.providerId || pick.modelId !== created.modelId) {
      const outcome = await deps.patchSession(created.id, {
        ...(agentChanged ? { agentId } : {}),
        providerId: pick.providerId ?? '', modelId: pick.modelId ?? '',
      })
      if (outcome === 'discarded') throw new Error('Selection wasn’t saved.')
    }
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

  /** Clear the draft's panel if it pointed at what a remove just dropped —
   *  the same RULE as the real-session funnel's clearDanglingFocus
   *  (focusValidIn, the one shared source); this applier stays separate
   *  because the core is dependency-injected and a draft has no panel pref
   *  to remember. */
  const reconcileFocus = (next: Live): void => {
    const focus = deps.store.get(DRAFT_ID).focus
    if (focus && !focusValidIn(next, focus)) deps.store.setFocus(DRAFT_ID, null)
  }

  /** Remove attached contexts from the draft (the composer's chip remove) —
   *  optimistic live + buffer purge + dangling-panel clear; no server writes
   *  (a draft has no row — the real-session funnel's detach/persist would
   *  just 404). */
  const removeContexts = (focuses: PanelFocus[]): void => {
    // The SAME bucketing the live remove filters by (bucketFocuses) — the
    // purge below can't drift from the remove semantics it mirrors.
    const { wsIds, repoIds, connIds, attIds } = bucketFocuses(focuses)
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
      if (ctx.kind === 'discussion' || ctx.kind === 'artifact') return attIds.has(ctx.attachment.id) ? null : ctx
      return ctx
    })
    reconcileFocus(next)
  }

  /** Remove one source folder from the draft's shared workspace (and its seed). */
  const removeFolder = (sourceId: string): void => {
    const next = removeFolderFromLive(deps.store.get(DRAFT_ID).live, sourceId)
    deps.store.setLive(DRAFT_ID, next)
    purgeBuffer((ctx) =>
      ctx.kind === 'folder' && (ctx.folder?.id ?? ctx.artifacts[0]?.source?.id ?? slug(ctx.label)) === sourceId ? null : ctx,
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
    materializationKey = null
    contextFlushUncertain = false
    attemptedBindingIds.clear()
    resetGen += 1
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
    getPick: () => ConversationBinding,
    onSession?: (s: Session) => void,
    onAdopted?: (realId: string) => void,
  ): Promise<void> => {
    // Dispatch-time captures (synchronous, before any await): the panel choice
    // (now store-held, per-session) and the sanitized model pick.
    const draftFocus = deps.store.get(DRAFT_ID).focus
    const draftModel = sanitizePick(getPick())
    const expectedSessionUserId = deps.captureSessionWriteSourceUserId?.()
    const genAtDispatch = resetGen
    const conversationEpochAtDispatch = deps.store.epoch(DRAFT_ID)
    const accountAtDispatch = deps.accountGeneration?.()
    const retired = () => deps.accountGeneration !== undefined && deps.accountGeneration() !== accountAtDispatch
    const creationKey = materializationKey ?? crypto.randomUUID()
    materializationKey = creationKey
    let sid: string = DRAFT_ID
    let createdSession: Session | null = null
    let pending: Promise<Session> | null = null
    try {
      const create = () => deps.createSession(
        text,
        {
          agentId: draftModel.agentId,
          providerId: draftModel.providerId,
          modelId: draftModel.modelId,
          idempotencyKey: creationKey,
          expectedSessionUserId,
          freezeSessionWriteSource: true,
        },
      )
      // A failed response is ambiguous: the row may already be durable. One
      // bounded same-key retry either returns that represented row or safely
      // performs the still-missing create. Only two failures may degrade to an
      // ephemeral draft turn.
      pending = materializing ?? create().catch(() => create())
      materializing = pending
      const created = await pending
      if (retired()) return
      createdSession = created
      sid = created.id
      // The draft was RESET while materializing (New session / a seed launch /
      // the root route): this send is orphaned — still land its turn on the
      // materialized session server-side, but do NOT touch the current draft's
      // live state (seeds, focus, entry, pane) which now belongs to a NEW draft.
      if (resetGen !== genAtDispatch) {
        await confirmBinding(created, draftModel)
        if (!retired()) await deps.store.sendTurn(sid, text)
        return
      }
      onSession?.(created)
      // Flush the pre-attached contexts BEFORE the turn streams: generation
      // derives an attached connector/MCP's tools from the session's
      // server-side contexts (P6), so the bindings must land first. Panels are
      // derived from the SAME seeds (not a live read — a mid-flight navigation
      // could have replaced the live state), keeping binding-of-record and
      // panels in lock-step.
      // Served-folder Refresh updates the draft's canonical snapshot after its
      // intake seed was buffered. Rebase that seed onto the same live draft
      // just before materialization so the first persisted workspace and its
      // source binding keep the acknowledged captured folder.
      const draftLive = deps.store.get(DRAFT_ID).live
      const seeded = pendingContexts.map((ctx) => {
        if (ctx.kind !== 'folder' || !ctx.folder) return ctx
        const latest = draftLive.workspaces.flatMap((workspace) => workspaceFolders(workspace))
          .find((folder) => folder.id === ctx.folder!.id)
        return latest ? { ...ctx, folder: latest } : ctx
      })
      const submittedDiscussionCaptures = new Map(seeded.flatMap((ctx) =>
        ctx.kind === 'discussion' && ctx.attachment.discussionCaptureId
          ? [[ctx.attachment.id, ctx.attachment.discussionCaptureId] as const]
          : [],
      ))
      const submittedArtifactCaptures = new Map(seeded.flatMap((ctx) =>
        ctx.kind === 'artifact' && ctx.attachment.artifactCaptureId
          ? [[ctx.attachment.id, ctx.attachment.artifactCaptureId] as const]
          : [],
      ))
      if (seeded.length || contextFlushUncertain) {
        const seededLive = seeded.reduce((l, ctx) => addContextToLive(l, ctx), EMPTY_LIVE)
        const desiredBindings = seeded.flatMap(bindingsFor)
        const desiredBindingIds = new Set(desiredBindings.map((binding) => binding.id))
        const operations = [
          ...desiredBindings.map((context) => ({ action: 'attach' as const, context })),
          ...[...attemptedBindingIds].filter((id) => !desiredBindingIds.has(id))
            .map((contextId) => ({ action: 'detach' as const, contextId })),
        ]
        // Remember intent before yielding: a rejected promise may mean the
        // complete transaction committed but its response was lost. Discussion
        // copies have no effect binding, so the separate latch covers them too.
        contextFlushUncertain = true
        for (const binding of desiredBindings) attemptedBindingIds.add(binding.id)
        const acknowledged = await deps.updateContextState(sid, {
          operations,
          workspace: workspaceOf(seededLive),
        }, expectedSessionUserId)
        if (retired()) return
        if (resetGen !== genAtDispatch) {
          await confirmBinding(created, draftModel)
          if (!retired()) await deps.store.sendTurn(sid, text)
          return
        }
        // Adopt the acknowledged saved copy for each unchanged submitted
        // capture intent. A same-source re-selection during an ambiguous retry
        // can legitimately receive an older already-saved snapshot receipt.
        const current = deps.store.get(DRAFT_ID).live
        const captured = new Map(acknowledged.workspace.attachments.map((item) => [item.id, item]))
        deps.store.setLive(DRAFT_ID, { ...current, attachments: current.attachments.map((item) => {
          const saved = captured.get(item.id)
          if (item.kind === 'artifact' && item.artifactCaptureId &&
            submittedArtifactCaptures.get(item.id) === item.artifactCaptureId &&
            saved?.kind === 'artifact' && saved.artifactSnapshot) return saved
          return item.kind === 'discussion' && item.discussionCaptureId &&
            submittedDiscussionCaptures.get(item.id) === item.discussionCaptureId &&
            saved?.kind === 'discussion' && saved.discussionSnapshot ? saved : item
        }) })
        pendingContexts = []
        contextFlushUncertain = false
        attemptedBindingIds.clear()
      }
      // Carry the draft's panel choice onto the real session (FWD-2): the
      // draft couldn't persist a pref (no server id), so an explicitly-closed
      // panel would otherwise be re-opened by strongestFocus on reopen.
      deps.setPanelPref(sid, draftFocus)
      // A late choice or an exact-key retry can differ from the represented
      // row. Confirm the entire binding before first send; a held correction
      // must not race generation under the previous Agent/provider.
      await confirmBinding(created, sanitizePick(getPick()))
      if (retired() || resetGen !== genAtDispatch) return
      // The draft entry's optimistic state (user turn(s), flags, focus) moves
      // under the real id — once; a coalesced second send finds the slot blank
      // and adopt() skips it.
      deps.store.adopt(DRAFT_ID, sid)
      onAdopted?.(sid)
    } catch (error) {
      // If session creation failed, stream against the draft id as a deliberate
      // offline fallback. If the session exists but its context transaction
      // failed, retain that row and expose a retryable pre-send failure instead.
      // A later retry reuses the row; never mint a trail of blank duplicates.
      if (!createdSession && materializing === pending) materializing = null
      // A superseded draft owns neither this failure nor its fallback send.
      // Let the abandoned attempt end without poisoning the newly reset draft.
      if (resetGen !== genAtDispatch || retired()) return
      if (createdSession || draftModel.agentId) {
        // The real row exists, but the atomic context transaction was not confirmed.
        // Keep this exact user turn retryable on the draft; the person can
        // remove a refused queued source before retrying, and no POST targets
        // the synthetic DRAFT_ID (or sends without the requested context).
        const detail = error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : ''
        deps.store.failPendingSend(
          DRAFT_ID,
          conversationEpochAtDispatch,
          text,
          `Couldn’t confirm context or Agent choice.${detail}`,
        )
        return
      }
      sid = DRAFT_ID
    }
    await deps.store.sendTurn(sid, text)
  }

  return { addSeed, attach, removeContexts, removeFolder, bufferContext, clearBuffer, reset, sendDraftTurn, sanitizePick }
}
