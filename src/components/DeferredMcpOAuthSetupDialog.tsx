import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import type { McpOAuthDecisionResponse, McpOAuthErrorCode, McpOAuthReviewResponse, McpOAuthStartResponse } from '../../contract/mcpOAuth.ts'
import { accountGeneration } from '../api/account.ts'
import { authorizeDesktopMcpOAuth, cancelDesktopMcpOAuth, clearHeldDesktopMcpOAuthFlow, getHeldDesktopMcpOAuthFlow, holdDesktopMcpOAuthFlow, reconcileDesktopMcpOAuth, reviewDesktopMcpOAuth, settleHeldDesktopMcpOAuthCancellation, startDesktopMcpOAuth } from '../api/desktopMcpOAuth.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS, dialogReadRegionProps } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { Spinner } from './Spinner.tsx'
import { CheckboxRow } from './Checkbox.tsx'

const secondary = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`
const primary = `${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`
const field = 'mt-1 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink'
const errorCopy: Record<McpOAuthErrorCode, string> = {
  request: 'The OAuth request was not accepted. Review the selected server and try again.',
  busy: 'Another MCP OAuth operation is still being resolved. Wait briefly, then check again.',
  stale: 'Your account or this server changed. Close this review and reload the connection.',
  expired: 'This review expired. Close it and start again from the current connection.',
  cancelled: 'The sign-in was cancelled.',
  conflict: 'This connection changed after review. Reload it before starting another sign-in.',
  unavailable: 'Native OAuth is unavailable right now. No token was exposed to this window.',
}
const messageFor = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: McpOAuthErrorCode }).code : undefined
  return code && code in errorCopy ? errorCopy[code] : errorCopy.unavailable
}
const isTerminalFlowError = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'expired' || code === 'stale' || code === 'conflict' || code === 'cancelled'
}

type Phase = 'intro' | 'discovering' | 'issuer' | 'reviewing' | 'scopes' | 'authorizing' | 'checking' | 'pending' | 'complete'
export function DeferredMcpOAuthSetupDialog({ connection, tenantId, userId, onClose, onComplete }: {
  connection: McpConnectionView; tenantId: string; userId: string; onClose: () => void; onComplete: () => void
}) {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const flow = useRef<McpOAuthStartResponse | null>(null)
  const generation = useRef<number | null>(null)
  const effectIdentity = useRef('')
  const [phase, setPhase] = useState<Phase>('intro')
  const [issuer, setIssuer] = useState('')
  const [servers, setServers] = useState<string[]>([])
  const [review, setReview] = useState<McpOAuthReviewResponse | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const busy = ['discovering', 'reviewing', 'authorizing', 'checking'].includes(phase)
  useFocusTrap(dialogRef, () => { if (!busy) void closeFlow() })
  useBoundedDialog(dialogRef)

  useEffect(() => {
    const identity = JSON.stringify([connection.id, tenantId, userId])
    const changedSource = effectIdentity.current !== '' && effectIdentity.current !== identity
    effectIdentity.current = identity
    if (changedSource) {
      flow.current = null
      setPhase('intro')
      setError(null)
    }
    alive.current = true
    generation.current = accountGeneration()
    const recovered = getHeldDesktopMcpOAuthFlow(connection.id, { tenantId, userId })
    if (recovered) {
      flow.current = recovered
      setPhase('pending')
      setError('A previous sign-in may have submitted inspection. Check its status before starting another sign-in.')
    }
    return () => {
      alive.current = false
      const currentFlow = flow.current
      if (currentFlow) queueMicrotask(() => {
        // StrictMode replays mount effects synchronously. The next setup
        // suppresses this deferred cancel; a real unmount or source change
        // still cancels the exact held flow.
        if (alive.current && effectIdentity.current === identity) return
        void cancelDesktopMcpOAuth({ flowId: currentFlow.flowId }).then(result => {
          settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow,
            result.status === 'inspection-pending' ? 'inspection-pending' : 'cancelled')
        }).catch(() => settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow, 'unknown'))
      })
    }
  }, [connection.id, tenantId, userId])

  const stillCurrent = () => generation.current === accountGeneration()
  const pinOrStop = async () => {
    if (stillCurrent()) return true
    const currentFlow = flow.current
    if (currentFlow) void cancelDesktopMcpOAuth({ flowId: currentFlow.flowId }).then(result => {
      settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow,
        result.status === 'inspection-pending' ? 'inspection-pending' : 'cancelled')
    }).catch(() => settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow, 'unknown'))
    if (alive.current) { setPhase('intro'); setError('The signed-in account changed. Start again from the current account.') }
    flow.current = null
    return false
  }
  const start = async () => {
    if (busy || flow.current) return
    if (!(await pinOrStop())) return
    setPhase('discovering'); setError(null)
    try {
      const result = await startDesktopMcpOAuth({ connectionId: connection.id, expectedRevision: connection.revision,
        source: { tenantId, userId } })
      if (!alive.current) {
        try {
          const cancelled = await cancelDesktopMcpOAuth({ flowId: result.flowId })
          settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, result,
            cancelled.status === 'inspection-pending' ? 'inspection-pending' : 'cancelled', true)
        } catch { settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, result, 'unknown', true) }
        return
      }
      flow.current = result
      if (!(await pinOrStop())) return
      holdDesktopMcpOAuthFlow(connection.id, { tenantId, userId }, result)
      setServers(result.authorizationServers)
      setIssuer(result.authorizationServers[0] ?? '')
      setPhase('issuer')
    } catch (cause) {
      if (alive.current && stillCurrent()) { setError(messageFor(cause)); setPhase('intro') }
    }
  }
  const reviewIssuer = async () => {
    const currentFlow = flow.current
    if (!currentFlow || !issuer || busy) return
    if (!(await pinOrStop())) return
    setPhase('reviewing'); setError(null)
    try {
      const result = await reviewDesktopMcpOAuth({ flowId: currentFlow.flowId, issuer })
      if (!alive.current || !(await pinOrStop())) return
      setReview(result); setSelectedScopes([]); setPhase('scopes')
    } catch (cause) {
      if (alive.current && stillCurrent()) {
        setError(messageFor(cause))
        if (isTerminalFlowError(cause)) {
          flow.current = null
          clearHeldDesktopMcpOAuthFlow(connection.id, { tenantId, userId }, currentFlow.flowId)
          setPhase('intro')
        } else setPhase('issuer')
      }
    }
  }
  const applyDecision = (result: McpOAuthDecisionResponse, currentFlow: McpOAuthStartResponse) => {
    if (result.status === 'complete') {
      flow.current = null
      clearHeldDesktopMcpOAuthFlow(connection.id, { tenantId, userId }, currentFlow.flowId)
      setPhase('complete')
      onComplete()
    }
    else setPhase('pending')
  }
  const authorize = async () => {
    const currentFlow = flow.current
    if (!currentFlow || !review || busy) return
    if (!(await pinOrStop())) return
    setPhase('authorizing'); setError(null)
    try {
      const result = await authorizeDesktopMcpOAuth({ flowId: currentFlow.flowId, scopes: selectedScopes })
      if (!alive.current || !(await pinOrStop())) return
      applyDecision(result, currentFlow)
    } catch (cause) {
      if (alive.current && stillCurrent()) {
        setError(messageFor(cause))
        const terminal = isTerminalFlowError(cause)
        setPhase(terminal ? 'intro' : 'scopes')
        if (terminal) {
          flow.current = null
          clearHeldDesktopMcpOAuthFlow(connection.id, { tenantId, userId }, currentFlow.flowId)
        }
      }
    }
  }
  const reconcile = async () => {
    const currentFlow = flow.current
    if (!currentFlow || phase !== 'pending' || busy) return
    if (!(await pinOrStop())) return
    setPhase('checking')
    setError(null)
    try {
      const result = await reconcileDesktopMcpOAuth({ flowId: currentFlow.flowId })
      if (!alive.current || !(await pinOrStop())) return
      applyDecision(result, currentFlow)
    } catch (cause) {
      if (alive.current && stillCurrent()) {
        setError(messageFor(cause))
        if (isTerminalFlowError(cause)) {
          flow.current = null
          clearHeldDesktopMcpOAuthFlow(connection.id, { tenantId, userId }, currentFlow.flowId)
          setPhase('intro')
        } else setPhase('pending')
      }
    }
  }
  const closeFlow = async () => {
    const currentFlow = flow.current
    if (currentFlow) {
      try {
        const result = await cancelDesktopMcpOAuth({ flowId: currentFlow.flowId })
        settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow,
          result.status === 'inspection-pending' ? 'inspection-pending' : 'cancelled')
      } catch {
        // Preserve the opaque handle for a later status check if cancellation
        // could not establish whether inspection had already been submitted.
        settleHeldDesktopMcpOAuthCancellation(connection.id, { tenantId, userId }, currentFlow, 'unknown')
      }
      flow.current = null
    }
    onClose()
  }

  return createPortal(<div className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={() => { if (!busy) void closeFlow() }} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} tabIndex={-1} data-bounded-dialog="mcp-oauth-review" onMouseDown={event => event.stopPropagation()}
      className={`w-full max-w-lg ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}>
      <header className="shrink-0 p-4 pb-0">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold text-ink">Sign in to {connection.label}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">OAuth sign-in opens your browser. This window receives only the inspected connection status. Tokens are stored encrypted on this Mac. No MCP tools are run or approved here.</p>
      </header>
      <div {...dialogReadRegionProps('OAuth sign-in review')} className={`p-4 ${BOUNDED_DIALOG_BODY_CLASS}`}>
        {phase === 'intro' && <div className="mt-4 space-y-3">
          <p className="text-[13px] text-ink-soft">The connection was last reviewed at revision {connection.revision}. First, discover the service’s advertised authorization servers.</p>
          <button type="button" onClick={() => void start()} className={primary}>Find sign-in options</button>
        </div>}
        {phase === 'discovering' && <p role="status" className="mt-4 flex items-center gap-2 text-[13px] text-ink-soft"><Spinner size={14} />Checking the server’s sign-in options…</p>}
        {phase === 'issuer' && <div className="mt-4 space-y-3">
          {!servers.length && <p role="status" className="text-[12px] text-ink-soft">The server did not advertise an authorization server. Cancel and contact its administrator.</p>}
          <label htmlFor={`${id}-issuer`} className="block text-[12px] font-medium text-ink">Authorization server
            <select id={`${id}-issuer`} value={issuer} onChange={event => setIssuer(event.target.value)} className={field}>
              {servers.map(server => <option key={server} value={server}>{server}</option>)}
            </select>
          </label>
          <p className="break-all text-[12px] text-ink-soft">The selected issuer is supplied by the MCP server and will be reviewed before sign-in.</p>
          <button type="button" disabled={!issuer} onClick={() => void reviewIssuer()} className={primary}>Review access request</button>
        </div>}
        {phase === 'reviewing' && <p role="status" className="mt-4 flex items-center gap-2 text-[13px] text-ink-soft"><Spinner size={14} />Loading the issuer’s authorization requirements…</p>}
        {phase === 'scopes' && review && <div className="mt-4 space-y-3">
          <div className="rounded-md border border-line p-3">
            <p className="text-[12px] font-medium text-ink">Reviewed issuer</p><p className="mt-1 break-all text-[12px] text-ink-soft">{review.issuer}</p>
            <p className="mt-3 text-[12px] font-medium text-ink">Available permissions</p>
            {review.scopesSupported.length ? <div className="mt-2 space-y-2">{review.scopesSupported.map(scope => <CheckboxRow key={scope}
              checked={selectedScopes.includes(scope)} onToggle={() => setSelectedScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope])}
              className="w-full min-w-0 text-[12px] text-ink">
              <span className="break-all">{scope}{review.suggestedScopes.includes(scope) ? ' · suggested by server' : ''}</span>
            </CheckboxRow>)}</div> : <p className="mt-1 text-[12px] text-ink-soft">No optional scopes were advertised. Continue with the authorization request as reviewed.</p>}
            <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">Suggestions are not selected automatically. The external service may apply its own terms, limits, or charges; this app cannot set or guarantee those.</p>
          </div>
          <button type="button" onClick={() => void authorize()} className={primary}>Continue to browser sign-in</button>
        </div>}
        {phase === 'authorizing' && <div className="mt-4 space-y-3">
          <p role="status" className="flex items-center gap-2 text-[13px] text-ink-soft"><Spinner size={14} />Waiting for sign-in and connection inspection…</p>
          <p className="text-[12px] leading-relaxed text-ink-soft">Finish in the browser that opened. Cancel stops this attempt; it does not grant tool access.</p>
        </div>}
        {(phase === 'pending' || phase === 'checking') && <div className="mt-4 space-y-3">
          <p role="status" className="text-[13px] text-warn-text">Connection inspection may have reached the server, but its acknowledgement is not confirmed. Do not sign in again yet.</p>
          {phase === 'checking'
            ? <p role="status" className="flex items-center gap-2 text-[12px] text-ink-soft"><Spinner size={13} />Checking current connection status…</p>
            : <button type="button" disabled={busy} onClick={() => void reconcile()} className={primary}>Check status</button>}
        </div>}
        {phase === 'complete' && <p role="status" className="mt-4 text-[13px] text-ink-soft">Connection updated. Tool access still requires separate, per-call approval.</p>}
        {error && <p role="alert" className="mt-3 text-[12px] leading-relaxed text-danger-text">{error}</p>}
      </div>
      <div data-mcp-oauth-actions className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-panel px-4 py-3">
        {phase === 'pending' && <button type="button" onClick={() => void closeFlow()} className={secondary}>Close and keep recovery</button>}
        {phase !== 'pending' && <button type="button" onClick={() => void closeFlow()} className={secondary}>{phase === 'complete' ? 'Done' : 'Cancel'}</button>}
      </div>
    </div>
  </div>, document.body)
}
