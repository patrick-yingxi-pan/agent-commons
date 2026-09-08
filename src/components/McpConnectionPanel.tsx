import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { useMe, resolveResourceUnavailable, retryResourceQueries, keys } from '../api'
import { accountGeneration } from '../api/account.ts'
import { useMcpConnection, useMcpConnections } from '../api/mcpConnectionHooks.ts'
import { desktopMcpCredentialsAvailable, getMcpConnectionCredentialBinding, provisionDesktopMcpCredential } from '../api/desktopMcpCredentials.ts'
import {
  enqueueMcpConnectionMutation, isMcpConnectionHeld, useMcpConnectionMutationStatus, useMcpConnectionHeldViews,
} from '../controller/mcpConnectionMutations.ts'
import { AtomicResourcePage, ResourcePageSection, ResourceUnavailablePage } from './ResourcePage.tsx'
import { BackButton } from './BackButton.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Spinner } from './Spinner.tsx'
import { McpCatalogBody } from './McpCatalogBody.tsx'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import type { NavLocation } from '../lib/nav.ts'

const fieldClass = 'mt-1 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink'
const secondaryClass = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`
const affirmativeClass = `${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`
const contextsHome: NavLocation = { kind: 'section', section: 'contexts', projectId: null, scheduleId: null }

function McpFormDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, onClose)
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className={SCRIM_CLASS} />
      <div ref={ref} tabIndex={-1} onMouseDown={event => event.stopPropagation()}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col ${DIALOG_SURFACE_CLASS}`}>
        <div className="overflow-y-auto p-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {children}
        </div>
      </div>
    </div>, document.body,
  )
}

/** Saving reserves one durable identity. Inspection is a separate, explicit
 * network action; creating a row never implies a successful connection. */
export function McpConnectionCreateDialog({ onClose }: { onClose: () => void }) {
  const id = useId()
  const me = useMe().data
  const catalog = useMcpConnections()
  const [label, setLabel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [authentication, setAuthentication] = useState<'none' | 'device-bearer'>('none')
  const deviceAvailable = desktopMcpCredentialsAvailable() && catalog.data?.capabilities.deviceBearerCredentials === true
  return <McpFormDialog title="Add an MCP server" onClose={onClose}>
    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
      Save a server, then inspect its tool catalog. Tool execution is not available yet.
    </p>
    <form className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault()
      if (!me || !label.trim() || !endpoint.trim()) return
      void enqueueMcpConnectionMutation({ kind: 'create', tenantId: me.tenant.id, request: {
        creationId: crypto.randomUUID(), label: label.trim(), endpoint: endpoint.trim(), authentication,
      } })
      onClose()
    }}>
      <label htmlFor={`${id}-name`} className="block text-[12px] font-medium text-ink">Name
        <input id={`${id}-name`} required maxLength={256} value={label} onChange={event => setLabel(event.target.value)} className={fieldClass} />
      </label>
      <label htmlFor={`${id}-endpoint`} className="block text-[12px] font-medium text-ink">Server URL
        <input id={`${id}-endpoint`} required type="url" maxLength={2048} value={endpoint} onChange={event => setEndpoint(event.target.value)}
          aria-describedby={`${id}-scope`} autoCapitalize="none" spellCheck={false} className={fieldClass} />
      </label>
      <p id={`${id}-scope`} className="text-[12px] leading-relaxed text-ink-soft">
        {catalog.data?.capabilities.loopbackConnections
          ? 'Public HTTPS or a literal loopback address on this device. Private network addresses and redirects are refused.'
          : 'Public HTTPS only. Local and private network addresses, redirects, and credentials embedded in URLs are refused.'}
      </p>
      <label htmlFor={`${id}-authentication`} className="block text-[12px] font-medium text-ink">Authentication
        <select id={`${id}-authentication`} value={authentication} onChange={event => setAuthentication(event.target.value as typeof authentication)} className={fieldClass}>
          <option value="none">No authentication</option>
          <option value="device-bearer" disabled={!deviceAvailable}>Bearer token on this Mac</option>
        </select>
      </label>
      <p className="text-[12px] leading-relaxed text-ink-soft">{deviceAvailable
        ? 'For bearer authentication, enter the token during inspection. It is encrypted on this Mac and never sent to the application API.'
        : 'Bearer authentication requires the desktop app and secure device credential storage.'}</p>
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
        <button type="submit" disabled={!me || !label.trim() || !endpoint.trim()} className={affirmativeClass}>Save server</button>
      </div>
    </form>
  </McpFormDialog>
}


function McpInspectionDialog({ connection, onClose }: { connection: McpConnectionView; onClose: () => void }) {
  const id = useId()
  const me = useMe().data
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const needsToken = connection.authentication === 'device-bearer' && connection.status !== 'connected'
  const close = () => { if (!busy) onClose() }
  return <McpFormDialog title="Inspect MCP server" onClose={close}>
    <p className="mt-2 break-words text-[13px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
      Contact {connection.label} and replace its saved catalog. Server descriptions are untrusted metadata. No tools will run.
    </p>
    <form className="mt-4 space-y-3" onSubmit={async event => {
      event.preventDefault()
      if (!me || busy || isMcpConnectionHeld(connection.id) || (needsToken && !token.trim())) return
      const generation = accountGeneration()
      setBusy(true); setError(null)
      try {
        let credentialReference: string | undefined
        if (token) {
          const { binding } = await getMcpConnectionCredentialBinding(connection.id, me.tenant.id)
          if (generation !== accountGeneration() || !mounted.current) return
          credentialReference = await provisionDesktopMcpCredential(binding, token)
          if (generation !== accountGeneration() || !mounted.current) return
        }
        void enqueueMcpConnectionMutation({ kind: 'inspect', tenantId: me.tenant.id, id: connection.id, reviewed: connection,
          request: { expectedRevision: connection.revision, operationId: crypto.randomUUID(), ...(credentialReference ? { credentialReference } : {}) } })
        setToken(''); onClose()
      } catch {
        if (generation === accountGeneration() && mounted.current) setError('Could not protect the credential on this device. No inspection was started. Try again or cancel.')
      } finally { if (mounted.current) setBusy(false) }
    }}>
      {connection.authentication === 'device-bearer' && <>
        <label htmlFor={`${id}-token`} className="block text-[12px] font-medium text-ink">{needsToken ? 'Bearer token' : 'Replacement bearer token (optional)'}
          <input id={`${id}-token`} type="password" autoComplete="off" spellCheck={false} required={needsToken} maxLength={8192}
            value={token} disabled={busy} onChange={event => setToken(event.target.value)} className={fieldClass} />
        </label>
        <p className="text-[12px] text-ink-soft">Stored encrypted on this Mac, bound to this account and this exact server. Disconnecting retires its credential.</p>
      </>}
      {error && <p role="alert" className="text-[12px] text-danger-text">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={close} className={secondaryClass}>Cancel</button>
        <button type="submit" disabled={busy || (needsToken && !token.trim())} className={`inline-flex items-center gap-2 ${affirmativeClass}`}>
          {busy && <Spinner size={13} />}{busy ? 'Protecting token…' : 'Inspect catalog'}
        </button>
      </div>
    </form>
  </McpFormDialog>
}

export function McpConnectionDetail({ id, onBack, backTo }: { id: string; onBack: () => void; backTo: NavLocation | null }) {
  const read = useMcpConnection(id)
  const list = useMcpConnections()
  const me = useMe().data
  const mutation = useMcpConnectionMutationStatus()
  const heldViews = useMcpConnectionHeldViews()
  const connection = read.data ?? heldViews.find(view => view.id === id)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [inspect, setInspect] = useState<McpConnectionView | null>(null)
  const [remove, setRemove] = useState<McpConnectionView | null>(null)
  const held = isMcpConnectionHeld(id)
  if (!connection) return <ResourceUnavailablePage title="MCP server" state={resolveResourceUnavailable([read], { notFoundIsMissing: true })}
    message="This MCP server is not available to this account (or no longer exists)." backTo={backTo ?? contextsHome} onBack={onBack}
    onRetry={() => retryResourceQueries([keys.mcpConnection(id)])} />
  const canInspect = connection.authentication === 'none' || (desktopMcpCredentialsAvailable() && list.data?.capabilities.deviceBearerCredentials === true)
  return <>
    <AtomicResourcePage data-mcp-connection={id}>
      <header className={PAGE_HEADER_CLASS}>
        <div className="flex min-w-0 grow basis-64 items-start gap-2">
          <BackButton to={backTo ?? contextsHome} onBack={onBack} />
          <div className="min-w-0"><h1 className={`${PAGE_TITLE_CLASS} break-words [overflow-wrap:anywhere]`}>{connection.label}</h1>
            <p className="mt-1 text-[13px] text-ink-soft">External MCP server · {connection.authentication === 'none' ? 'No authentication' : 'Device bearer authentication'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={held || !me || !canInspect} title={!canInspect ? 'Secure desktop credentials are unavailable.' : undefined}
            className={affirmativeClass} onClick={() => setInspect(connection)}>{connection.inspectedAt === null ? 'Inspect catalog' : connection.status === 'disconnected' ? 'Reconnect and inspect' : 'Refresh catalog'}</button>
          {connection.status === 'connected' && <button disabled={held || !me} className={secondaryClass} onClick={() => {
            if (me) void enqueueMcpConnectionMutation({ kind: 'disconnect', tenantId: me.tenant.id, id, expectedRevision: connection.revision, reviewed: connection })
          }}>Disconnect</button>}
          <button disabled={held || !me} className={secondaryClass} onClick={() => setRemove(connection)}>Remove</button>
        </div>
      </header>
      {held && <p role="status" className="mb-3 text-[12px] text-ink-soft">{mutation.error ? 'Waiting for recovery. Use Retry or Dismiss above.' : 'Updating this server…'}</p>}
      {list.data?.capabilities.credentialCleanupPending && <div className="mb-4 space-y-2 text-[12px] text-warn-text">
        <p>Device credential cleanup is pending. Disconnected credentials cannot be used, but encrypted copies may remain on this Mac.</p>
        <button disabled={held || !me} className={secondaryClass} onClick={() => { if (me) void enqueueMcpConnectionMutation({ kind: 'cleanup', tenantId: me.tenant.id, id, reviewed: connection }) }}>Retry credential cleanup</button>
      </div>}
      <ResourcePageSection title="Tool catalog" summary={`${connection.tools.length} tools`}><McpCatalogBody connection={connection} /></ResourcePageSection>
    </AtomicResourcePage>
    {inspect && <McpInspectionDialog connection={inspect} onClose={() => setInspect(null)} />}
    {remove && <ConfirmDialog title={`Remove ${remove.label}?`}
      body="This removes the saved server and retires its device credential. Existing context references will become unavailable. It does not delete anything on the external server."
      confirmLabel="Remove server" onCancel={() => setRemove(null)} onConfirm={() => {
        const reviewed = remove
        setRemove(null)
        if (me) void enqueueMcpConnectionMutation({ kind: 'remove', tenantId: me.tenant.id, id, expectedRevision: reviewed.revision, reviewed: reviewed })?.then(outcome => {
          if (outcome === 'applied' && mounted.current) onBack()
        })
      }} />}
  </>
}
