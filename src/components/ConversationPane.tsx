/** ── An independent conversation in a pane (universal split Phases 3+5) ──────
 *  The SAME fully-fledged ConversationView every host mounts — two panes on
 *  one session are two views in sync with the same keyed model (the store
 *  dedupes by key; the server's one-live-turn-per-session slot is the
 *  concurrency wall). This component is only the pane's WIRING: the
 *  per-session command adapter — send/stop/retry through the store, attach /
 *  remove through the shared funnels (useSessionContextCommands, the draft
 *  funnel), escalation approval through useSessionEscalation — never a
 *  parallel implementation. */
import { useCallback, useMemo, useRef, useState } from 'react'
import { SessionTitleBar } from './SessionTitleBar'
import { ConversationView } from './ConversationView'
import { DeferredConversationSearch } from './DeferredConversationSearch'
import { EmptyState } from './EmptyState'
import { AtomicResourcePage } from './ResourcePage'
import type { MainPaneNav, PaneBackOut } from './MainSplit'
import { navLocationOfLoc } from '../lib/paneHistory'
import { useSessions, useSchedules, useProviders, keys, peek } from '../api'
import { runSessionId } from '../../contract/ids.ts'
import { pickedModel, pickedProvider, type ModelPick } from '../lib/models'
import { useModelPreferences } from '../controller/modelPreferences'
import { conversations } from '../controller/conversationStore'
import { usePaneConversation } from '../controller/usePaneConversation'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { enqueueSessionMetadataMutation } from '../controller/sessionMetadataMutations'
import { dismissContextMutation, retryContextMutation } from '../controller/contextMutations'
import { useSessionEscalation } from '../controller/useSessionEscalation'
import { useRelations } from '../controller/useRelations'
import { draft } from '../controller/draftController'
import { DRAFT_ID, approvalView } from '../data/liveSession'
import type { Session } from '../types'
import { modelSetupRequired } from '../lib/modelExecution'

export function ConversationPane({
  sessionId,
  nav,
  backOut,
}: {
  sessionId: string
  nav: MainPaneNav
  /** The carried back stack's top (ADAPT-18) — non-null when this
   *  conversation was opened from a PAGE (a session row, a run row): the
   *  title bar leads with the back control naming that origin. */
  backOut?: PaneBackOut
}) {
  const conv = usePaneConversation(sessionId)
  // The LIVE row — with the loadSession-cache fallback for rows the list
  // doesn't carry (run sessions): title, routine breadcrumb, compact, and the
  // writable model pick all resolve for them too.
  const row =
    (useSessions().data ?? []).find((s) => s.id === sessionId) ?? peek<Session>(keys.session(sessionId))
  const isDraft = sessionId === DRAFT_ID
  const [searchSession, setSearchSession] = useState<string | null>(null)
  const canControlTurn = isDraft || row?.own === true
  const providersQ = useProviders()
  const providers = providersQ.data ?? []
  const { preferences } = useModelPreferences()
  const relations = useRelations()
  const needsModelSetup = isDraft && providersQ.data !== undefined && modelSetupRequired(providersQ.data)

  // A run session's row isn't in the sessions list, and on its FIRST visit it
  // isn't in the loadSession cache either — but its ROUTINE identity already
  // sits in the live schedules registry (the run-history click-down that
  // navigated here read it). Deriving `scheduledRunOf` from that registry
  // keeps the title, breadcrumb, and run switcher mounted across a run switch
  // instead of blinking out until the server row resolves (UI-12: read the
  // live source).
  const schedules = useSchedules().data ?? []
  const runOfFallback = useMemo(() => {
    if (row) return undefined
    for (const t of schedules) {
      if (t.runs.some((r) => runSessionId(t.id, r.id) === sessionId)) return { taskId: t.id, taskName: t.name }
    }
    return undefined
  }, [row, schedules, sessionId])

  // The DRAFT's model pick is held locally (no server row to PATCH) — seeded
  // from the Customize default prefs, WRITABLE (the composer's picker), and
  // read at dispatch by the funnel. The usage strip resolves it against the
  // live registry (identity + context window; absent = honest unknown).
  const [localDraftPick, setDraftPick] = useState<ModelPick | null>(null)
  const draftPick: ModelPick = localDraftPick ?? {
    providerId: preferences.providerId,
    modelId: preferences.modelId,
  }
  const draftPickRef = useRef(draftPick)
  draftPickRef.current = draftPick
  const draftModelRef = useMemo(() => {
    if (!isDraft) return undefined
    const provider = pickedProvider(providers, draftPick)
    if (!provider) return undefined
    const model = pickedModel(provider, draftPick)
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      ...(model ? { modelId: model.id, modelLabel: model.label, windowTokens: model.contextWindow } : {}),
    }
  }, [isDraft, providers, draftPick])

  // A pane-hosted DRAFT sends through the SHARED draft funnel (draftCore.ts —
  // coalesced materialization, FWD-1 flush before the turn, FWD-2 focus
  // carry). This host's `onAdopted` retargets every draft pane to the real id.
  const sendDraft = useCallback(
    (text: string) => {
      conversations.update(DRAFT_ID, (s) => ({
        ...s,
        typing: true,
        busy: true,
        sendFailure: null,
        retryableSend: null,
        // The SHARED optimistic-id mint (not a hand-rolled `u-${Date.now()}`) so a
        // coalesced double-send can't collide on a React key / retry lookup.
        live: { ...s.live, messages: [...s.live.messages, { id: conversations.nextUserMessageId(), role: 'user' as const, content: text }] },
      }))
      void draft.sendDraftTurn(
        text,
        () => draftPickRef.current,
        undefined,
        (realId) => nav.onDraftAdopted(realId),
      )
    },
    [nav],
  )

  // Consent resolved: the one shared approval funnel (C27/C29).
  const approve = useSessionEscalation(sessionId, nav.sessionLabel)

  // The attach / remove funnels, session-parametric — the SAME hook a
  // context-panel pane's remove affordances use (useSessionContextCommands), so
  // the mapping can't fork per host. A pane session is always real (no
  // draft-buffering branch).
  const { addContext, removeContexts, removeFolder } = useSessionContextCommands(sessionId)

  const retry = useCallback(() => {
    if (isDraft) {
      // A draft whose first materialization failed must try the mint funnel
      // again; sending directly to the client-only draft id could never make
      // the recovered conversation durable. beginRetry keeps its one user row.
      const logical = conversations.beginRetry(DRAFT_ID)
      if (!logical) return
      void draft.sendDraftTurn(
        logical.text,
        () => draftPickRef.current,
        undefined,
        (realId) => nav.onDraftAdopted(realId),
      )
      return
    }
    void conversations.retryTurn(sessionId)
  }, [isDraft, nav, sessionId])

  // The session's two-level model pick: the draft's local hold, or the live
  // row's persisted fields (the same PATCH every picker writes — one wire).
  const modelPick: ModelPick = isDraft ? draftPick : { providerId: row?.providerId, modelId: row?.modelId }
  const selectModel = useCallback(
    (pick: ModelPick) => {
      if (sessionId === DRAFT_ID) setDraftPick(pick)
      else void enqueueSessionMetadataMutation(sessionId, { providerId: pick.providerId ?? '', modelId: pick.modelId ?? '' })
    },
    [sessionId],
  )

  return (
    <AtomicResourcePage layout="workspace" data-conversation-pane={sessionId}>
      {/* The SAME title bar every conversation wears (a run session outside
          the live list falls back to a title-only shell). */}
      <SessionTitleBar
        session={
          row ?? {
            id: sessionId,
            title: isDraft ? 'New session' : (runOfFallback?.taskName ?? nav.sessionLabel(sessionId)),
            scheduledRunOf: runOfFallback,
          }
        }
        leading={nav.railToggle}
        back={backOut ? { to: navLocationOfLoc(backOut.loc), onBack: backOut.go } : undefined}
        onOpenProject={nav.onOpenProject}
        onOpenSchedule={nav.onOpenSchedule}
        // A run session's floating run-history click-down (UI-15): selecting a
        // sibling run retargets THIS pane in place — the same session door as
        // every navigation.
        onSelectRun={nav.onOpenSession}
        onFind={!isDraft && row ? () => setSearchSession(sessionId) : undefined}
      />
      {searchSession === sessionId && <DeferredConversationSearch key={sessionId}
        sessionId={sessionId} onClose={() => setSearchSession(null)}
        onSelect={(messageId) => nav.onFocusHere({ messageId })} />}
      <ConversationView
        sessionId={sessionId}
        onOpenSession={nav.onOpenSession}
        live={conv.live}
        composerText={conv.composerText}
        onComposerTextChange={(composerText) => conversations.patch(sessionId, { composerText })}
        typing={conv.typing}
        busy={conv.busy}
        streaming={!!(conv.busy && conv.liveTurn)}
        sendFailure={conv.sendFailure}
        stopRequest={conv.stopRequest}
        canControlTurn={canControlTurn}
        turnControlPending={!isDraft && !row}
        canRetry={conv.retryableSend !== null}
        contextMutation={conv.contextMutation}
        pendingApproval={conv.pendingEscalation ? approvalView(conv.pendingEscalation.escalation) : null}
        history={conv.history}
        reconciled={conv.reconciled}
        initialReadError={conv.initialReadError}
        onRetryInitialRead={conv.retryInitialRead}
        onLoadEarlier={isDraft ? undefined : conv.loadEarlier}
        onApprove={approve}
        onSend={isDraft ? sendDraft : (text) => void conversations.dispatchTurn(sessionId, text)}
        onStop={() => conversations.stop(sessionId)}
        onRetry={retry}
        onRetryContext={() => retryContextMutation(sessionId)}
        onDismissContext={() => dismissContextMutation(sessionId)}
        canCompact={!!row && row.own !== false}
        modelPick={modelPick}
        onSelectModel={canControlTurn ? selectModel : undefined}
        usageModel={draftModelRef}
        focus={conv.focus}
        // A DRAFT has no server row to bind against — its attach AND removes
        // route through the draft funnel (FWD-1: buffered / purged, panel
        // opened / cleared, flushed onto the real session at materialization).
        // The composer attach STACKS (draft.attach) — never the launcher's
        // reset semantic, which would wipe an in-progress draft thread. A real
        // session takes the shared server-backed funnel.
        onAddContext={isDraft ? (ctx) => draft.attach(ctx) : addContext}
        onOpenContext={(f) => nav.onOpenSessionContext(sessionId, f)}
        onRemoveContexts={isDraft ? (fs) => draft.removeContexts(fs) : removeContexts}
        onRemoveFolder={isDraft ? (id) => draft.removeFolder(id) : removeFolder}
        empty={
          // The SAME empty surface for every host (one primitive — a draft
          // looks identical wherever it lives). The FWD-1 launcher reseeds
          // the shared draft entry; every draft view follows.
          <EmptyState
            mode={isDraft ? 'draft' : 'empty'}
            live={conv.live}
            onNewSessionWith={isDraft ? (ctx) => draft.addSeed(ctx) : undefined}
            onOpenModelSetup={needsModelSetup ? () => relations.navigate('models') : undefined}
          />
        }
      />
    </AtomicResourcePage>
  )
}
