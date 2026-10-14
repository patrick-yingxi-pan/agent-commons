import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { AddedContext, Attachment } from '../types'
import type { LocalGitConnection } from '../../contract/localGitCapture.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { fsRecentKey } from '../../contract/fs.ts'
import { accountGeneration } from '../api/account.ts'
import { captureLocalGit } from '../api/localGit.ts'
import { localGitSavedCopies } from '../controller/localGitSavedCopies.ts'
import { localGitConnections, useLocalGitConnections } from '../controller/localGitConnections.ts'
import { useRelations } from '../controller/useRelations'
import { UI_HOST_SOURCE } from '../lib/fsSources'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import type { NavLocation } from '../lib/nav'
import { CheckboxRow } from './Checkbox'
import { BackButton } from './BackButton'
import { AtomicResourcePage, ResourcePageSynopsisRow, ResourceUnavailablePage } from './ResourcePage'
import { GitSnapshotPolicy } from './GitSnapshotPolicy'

// Optional native review is requested only on its canonical page. The existing
// DeferredLocalGit boundary contains module failure and preserves navigation.
const LocalGitReview = lazy(() => import('./LocalGitReview.tsx').then(module => ({ default: module.LocalGitReview })))
const LocalGitBrowser = lazy(() => import('./LocalGitBrowser.tsx').then(module => ({ default: module.LocalGitBrowser })))

export function LocalGitStatus() {
  const state = useLocalGitConnections()
  if (state.status === 'error') return <div role="alert" className="space-y-2 py-2 text-[12px] text-danger-text">
    <p>{state.error}</p>
    <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => void localGitConnections.reload()}>Check repositories</button>
  </div>
  if (state.busy || state.status !== 'ready') return <p role="status" className="py-2 text-[12px] text-ink-soft">{state.busy ? 'Updating repository access…' : 'Checking repository connections…'}</p>
  return null
}

/** Choosing a repository grants read-only access. Attach is the separate
 * explicit capture act; browsing this picker never reads tracked files. */
export function LocalGitConnect() {
  const state = useLocalGitConnections()
  const [remember, setRemember] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return <div data-local-git-connect className="space-y-2 py-2">
    <p className="text-[12px] leading-snug text-ink-soft">Choose a repository on this device. Listing reads bounded Git metadata and applicable ignore files; tracked file contents are read only when you explicitly preview a path, attach or refresh a saved snapshot, or review changes on its page.</p>
    <CheckboxRow checked={remember} disabled={state.busy} onToggle={() => setRemember(value => !value)} className="text-[12px] text-ink">
      <span>Remember this connection<span className="block text-[11px] text-ink-soft">Keep access after relaunch until you disconnect. Otherwise select again next time.</span></span>
    </CheckboxRow>
    <button type="button" disabled={state.busy || state.status !== 'ready'} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
      onClick={() => {
        const generation = accountGeneration()
        void localGitConnections.connect(remember).then(connection => {
          if (connection && mounted.current && generation === accountGeneration()) setRemember(false)
        })
      }}>Choose a repository from this computer</button>
    <LocalGitStatus />
  </div>
}

export function NativeLocalGitPicker({ onAdd, addedIds, attachments, intentScope, allowSavedCopy, onClose }: { onAdd: (ctx: AddedContext) => void | Promise<unknown>; addedIds: readonly string[]; attachments: Attachment[]; intentScope: string; allowSavedCopy: boolean; onClose: () => void }) {
  const state = useLocalGitConnections()
  const rel = useRelations()
  const [reading, setReading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [browsingId, setBrowsingId] = useState<string | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const attach = async (connection: LocalGitConnection) => {
    if (!allowSavedCopy || busy.current || state.busy || state.status !== 'ready') return
    busy.current = true
    const generation = accountGeneration()
    setReading(connection.id)
    setError(null)
    try {
      const gitSnapshot = await captureLocalGit(connection.id)
      if (!active.current || generation !== accountGeneration()) return
      const folder = { id: fsRecentKey('ui-host', connection.id), label: connection.name, gitSnapshot }
      onAdd({ kind: 'folder', label: connection.name, folder, artifacts: [], source: UI_HOST_SOURCE })
    } catch {
      if (active.current && generation === accountGeneration()) setError('Could not capture this repository. Nothing was attached. Check the connection and try Attach again.')
    } finally {
      busy.current = false
      if (active.current && generation === accountGeneration()) setReading(null)
    }
  }
  return <section data-native-git-picker>
    <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">This computer</p>
    <LocalGitConnect />
    {allowSavedCopy ? <GitSnapshotPolicy /> : <p className="px-1 py-1 text-[11px] leading-relaxed text-ink-soft">Project context is descriptive. Browse and preview are read-only here; saved repository copies are available from a conversation.</p>}
    {reading && <p role="status" className="py-2 text-[12px] text-ink-soft">Capturing tracked files… Close this picker to leave without attaching.</p>}
    {error && <p role="alert" className="py-2 text-[12px] text-danger-text">{error}</p>}
    {state.status === 'ready' && <div>
      {state.rows.length === 0 && <p className="py-2 text-[12px] text-ink-soft">No repository connections. Choose one above, then browse files.</p>}
      {state.rows.map(connection => {
        const added = addedIds.includes(fsRecentKey('ui-host', connection.id))
        return <div key={connection.id} className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-2">
          <span className="min-w-0 flex-1"><span title={connection.name} className="block truncate text-[13px] text-ink">{connection.name}</span><span className="text-[11px] text-ink-soft">{connection.remembered ? 'Remembered on this device' : 'Until app closes'}</span></span>
          {allowSavedCopy && <button type="button" aria-label={`Attach ${connection.name}`} disabled={added || !!reading || state.busy} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => void attach(connection)}>{added ? 'Added' : 'Attach'}</button>}
          <button type="button" aria-label={`Browse files in ${connection.name}`} disabled={!!reading || state.busy || state.status !== 'ready'} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} aria-expanded={browsingId === connection.id} onClick={() => setBrowsingId(current => current === connection.id ? null : connection.id)}>Browse files</button>
          <button type="button" aria-label={`Manage ${connection.name}`} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => { onClose(); rel.navigate('contexts', connection.id) }}>Manage</button>
          {browsingId === connection.id && <div className="basis-full"><Suspense fallback={<p role="status" className="py-2 text-[12px] text-ink-soft">Loading file browser…</p>}>
            <LocalGitBrowser id={connection.id} name={connection.name} enabled={state.status === 'ready' && !state.busy && !reading} intentScope={intentScope}
              isAttached={(receipt, sourceKind = 'git') => {
                localGitSavedCopies.adoptAttachments(intentScope, attachments.map(item => item.id))
                const id = localGitSavedCopies.id(intentScope, connection.id, receipt, sourceKind)
                return id !== undefined && attachments.some(item => item.id === id)
              }}
              onAttach={allowSavedCopy ? (file: PreparedLocalFileSavedCopy) => {
                if (attachments.some(item => item.id === file.id)) return
                return onAdd({ kind: 'files', attachments: [{
                  id: file.id, label: file.name, kind: file.kind, source: UI_HOST_SOURCE,
                  ...(file.kind === 'file' ? { previewText: file.text } : { image: file.image }), ...(file.documentImport && { documentImport: file.documentImport }),
                }] })
              } : undefined} />
          </Suspense></div>}
        </div>
      })}
    </div>}
  </section>
}

export function LocalGitRow({ connection, onOpen }: { connection: LocalGitConnection; onOpen: () => void }) {
  return <ResourcePageSynopsisRow title={<span title={connection.name}>{connection.name}</span>} description="Read-only Git repository · this device" meta={connection.remembered ? 'Remembered' : 'Until app closes'} prefix={<GitBranch size={15} className="shrink-0 text-ink-soft" />} onOpen={onOpen} />
}

const contextsHome: NavLocation = { kind: 'section', section: 'contexts', projectId: null, scheduleId: null }

export function LocalGitDetail({ id, onBack, backTo }: { id: string; onBack: () => void; backTo: NavLocation | null }) {
  const state = useLocalGitConnections()
  const connection = state.rows.find(row => row.id === id)
  if (!connection || !state.available) return <ResourceUnavailablePage title="Local repository" state={!state.available || state.status === 'ready' ? 'missing' : state.status === 'error' ? 'error' : 'loading'}
    message="This repository connection is not available to this account on this device. Saved snapshots remain in their conversations."
    onBack={onBack} backTo={backTo ?? contextsHome} onRetry={() => void localGitConnections.reload()} />
  return <AtomicResourcePage data-local-git-detail={id}>
    <header className={PAGE_HEADER_CLASS}>
      <div className="flex min-w-0 grow basis-64 items-start gap-2">
        <BackButton to={backTo ?? contextsHome} onBack={onBack} />
        <div className="min-w-0"><h1 className={`${PAGE_TITLE_CLASS} break-words [overflow-wrap:anywhere]`}>{connection.name}</h1><p className="mt-1 text-[13px] text-ink-soft">Read-only Git repository · {connection.remembered ? 'Remembered on this device' : 'Access ends when the app closes'}</p></div>
      </div>
      <button type="button" disabled={state.busy || state.status !== 'ready'} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => void localGitConnections.disconnect(id)}>Disconnect</button>
    </header>
    <LocalGitStatus />
    <Suspense fallback={<p role="status" className="mt-6 text-[12px] text-ink-soft">Loading file browser…</p>}>
      <LocalGitBrowser id={connection.id} name={connection.name} enabled={state.status === 'ready' && !state.busy} />
    </Suspense>
    <Suspense fallback={<p role="status" className="mt-6 text-[12px] text-ink-soft">Loading repository review…</p>}>
      <LocalGitReview id={connection.id} enabled={state.status === 'ready' && !state.busy} />
    </Suspense>
    <div className="mt-6 space-y-3 text-[13px] leading-relaxed text-ink-soft">
      <p>In a conversation, choose Add context → Repository → This computer. Use Browse files → Attach saved copy to add one explicitly previewed file, or Attach to save the whole tracked snapshot. Refresh an attached repository explicitly to save later tracked edits. Opening this page does not automatically list paths or preview files.</p>
      <p>Disconnect ends future reads; saved snapshots in conversations remain available as model input until removed.</p>
      <GitSnapshotPolicy />
    </div>
  </AtomicResourcePage>
}
