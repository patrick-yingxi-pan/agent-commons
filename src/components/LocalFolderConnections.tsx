import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { AddedContext, Attachment } from '../types'
import type { LocalFolderConnection } from '../../contract/localFolderCapture.ts'
import { fsRecentKey } from '../../contract/fs.ts'
import { accountGeneration } from '../api/account.ts'
import { captureLocalFolder, localFolderTreeAvailable } from '../api/localFolders.ts'
import { localGitSavedCopies, localGitSavedCopyScope, newLocalGitSavedCopyId } from '../controller/localGitSavedCopies.ts'
import { localFolderConnections, useLocalFolderConnections } from '../controller/localFolderConnections.ts'
import { useRelations } from '../controller/useRelations'
import { UI_HOST_SOURCE } from '../lib/fsSources'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import type { NavLocation } from '../lib/nav'
import { CheckboxRow } from './Checkbox'
import { BackButton } from './BackButton'
import { AtomicResourcePage, ResourcePageSynopsisRow, ResourceUnavailablePage } from './ResourcePage'

const LocalFolderBrowser = lazy(() => import('./LocalFolderBrowser.tsx').then(module => ({ default: module.LocalFolderBrowser })))

export function LocalFolderStatus() {
  const state = useLocalFolderConnections()
  if (state.status === 'error') return <div role="alert" className="space-y-2 py-2 text-[12px] text-danger-text">
    <p>{state.error}</p>
    <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => void localFolderConnections.reload()}>Check connections</button>
  </div>
  if (state.busy || state.status !== 'ready') return <p role="status" className="py-2 text-[12px] text-ink-soft">{state.busy ? 'Updating local connection…' : 'Checking local connections…'}</p>
  return null
}

/** Connect grants read-only device access but does not read or attach content. */
export function LocalFolderConnect({ onConnected }: { onConnected?: (connection: LocalFolderConnection) => void }) {
  const state = useLocalFolderConnections()
  const [remember, setRemember] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return <div data-local-folder-connect className="space-y-2 py-2">
    <p className="text-[12px] leading-snug text-ink-soft">Choose read-only access on this device. Browsing lists bounded path metadata; file content is read only when you explicitly preview a path or attach a saved snapshot.</p>
    <CheckboxRow checked={remember} disabled={state.busy} onToggle={() => setRemember(value => !value)} className="text-[12px] text-ink">
      <span>Remember this connection<span className="block text-[11px] text-ink-soft">Keep access after relaunch until you disconnect. Otherwise select again next time.</span></span>
    </CheckboxRow>
    <button type="button" disabled={state.busy || state.status !== 'ready'} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
      onClick={() => {
        const generation = accountGeneration()
        void localFolderConnections.connect(remember).then(connection => {
          if (connection && mounted.current && generation === accountGeneration()) { setRemember(false); onConnected?.(connection) }
        })
      }}>Choose a folder from this computer</button>
    <LocalFolderStatus />
  </div>
}

export function NativeLocalFolderPicker({ onAdd, addedIds, attachments = [], intentScope = '', allowSavedCopies = true, onClose }: { onAdd: (ctx: AddedContext) => void | Promise<unknown>; addedIds: readonly string[]; attachments?: Attachment[]; intentScope?: string; allowSavedCopies?: boolean; onClose: () => void }) {
  const state = useLocalFolderConnections()
  const rel = useRelations()
  const [reading, setReading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeSubfolders, setIncludeSubfolders] = useState(false)
  const [browsingId, setBrowsingId] = useState<string | null>(null)
  const savedCopyScope = intentScope || localGitSavedCopyScope()
  const active = useRef(true)
  const busy = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const attach = async (connection: LocalFolderConnection) => {
    if (!allowSavedCopies || busy.current || state.busy || state.status !== 'ready') return
    busy.current = true
    const generation = accountGeneration()
    setReading(connection.id)
    setError(null)
    try {
      const localSnapshot = await captureLocalFolder(connection.id, crypto.randomUUID(), window, includeSubfolders ? 'recursive' : 'flat')
      if (!active.current || generation !== accountGeneration()) return
      const folder = { id: fsRecentKey('ui-host', connection.id), label: `${connection.name}/`, localSnapshot }
      onAdd({ kind: 'folder', label: connection.name, folder, artifacts: [], source: UI_HOST_SOURCE })
    } catch {
      if (active.current && generation === accountGeneration()) setError('Could not read this folder. Nothing was attached. Check the connection and try Attach again.')
    } finally {
      busy.current = false
      if (active.current && generation === accountGeneration()) setReading(null)
    }
  }
  return <div data-native-folder-picker>
    <LocalFolderConnect />
    {allowSavedCopies && localFolderTreeAvailable() && <>
      <CheckboxRow checked={includeSubfolders} disabled={!!reading || state.busy} onToggle={() => setIncludeSubfolders(value => !value)} className="py-1 text-[12px] text-ink">
        Include subfolders
      </CheckboxRow>
      <p className="text-[11px] leading-snug text-ink-soft">{includeSubfolders ? 'Includes visible root-relative paths up to 16 levels, 64 folders and 500 entries.' : 'Unchecked: only top-level files are included.'} Hidden paths and symlinks are excluded.</p>
    </>}
    {allowSavedCopies ? <p className="py-2 text-[11px] leading-snug text-ink-soft">Attach saves up to 24 readable text files, 64 KB each and 128 KB total. Hidden files are excluded{includeSubfolders ? '; subfolders follow the option above' : '; subfolders are excluded'}. Other entries stay listed without text. Only saved text feeds the model; opening, previewing and sending never reread files. Originals never change.</p>
      : <p className="py-2 text-[11px] leading-snug text-ink-soft">Project context is descriptive. Browse and preview are read-only here; attaching saved folder copies is available only in a conversation.</p>}
    {reading && <p role="status" className="py-2 text-[12px] text-ink-soft">Reading folder… Close this picker to leave without attaching.</p>}
    {error && <p role="alert" className="py-2 text-[12px] text-danger-text">{error}</p>}
    {state.status === 'ready' && <div>
      {state.rows.length === 0 && <p className="py-2 text-[12px] text-ink-soft">No local connections. Choose a folder above, then attach its snapshot.</p>}
      {state.rows.map(connection => {
        const added = addedIds.includes(fsRecentKey('ui-host', connection.id))
        return <div key={connection.id} className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-2">
          <span className="min-w-0 flex-1"><span title={connection.name} className="block truncate text-[13px] text-ink">{connection.name}</span><span className="text-[11px] text-ink-soft">{connection.remembered ? 'Remembered on this device' : 'Until app closes'}</span></span>
          {allowSavedCopies && <button type="button" aria-label={`Attach ${connection.name}`} disabled={added || !!reading || state.busy} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => void attach(connection)}>{added ? 'Added' : 'Attach'}</button>}
          <button type="button" aria-label={`Browse files in ${connection.name}`} disabled={!!reading || state.busy || state.status !== 'ready'} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} aria-expanded={browsingId === connection.id} onClick={() => setBrowsingId(current => current === connection.id ? null : connection.id)}>Browse files</button>
          <button type="button" aria-label={`Manage ${connection.name}`} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => { onClose(); rel.navigate('contexts', connection.id) }}>Manage</button>
          {browsingId === connection.id && <div className="basis-full"><Suspense fallback={<p role="status" className="py-2 text-[12px] text-ink-soft">Loading file browser…</p>}>
            <LocalFolderBrowser id={connection.id} name={connection.name} enabled={state.status === 'ready' && !state.busy && !reading} intentScope={savedCopyScope} headingLevel={3}
              isAttached={receipt => {
                localGitSavedCopies.adoptAttachments(savedCopyScope, attachments.map(item => item.id))
                const savedId = localGitSavedCopies.id(savedCopyScope, connection.id, receipt, 'folder')
                return savedId !== undefined && attachments.some(item => item.id === savedId)
              }}
              onAttach={allowSavedCopies ? (path, text, receipt) => {
                const result = localGitSavedCopies.submit(savedCopyScope, connection.id, receipt, newLocalGitSavedCopyId, savedId => {
                  if (attachments.some(item => item.id === savedId)) return
                  return onAdd({ kind: 'files', attachments: [{ id: savedId, label: path, kind: 'file', source: UI_HOST_SOURCE, previewText: text }] })
                }, 'folder')
                return result.promise
              } : undefined} />
          </Suspense></div>}
        </div>
      })}
    </div>}
  </div>
}

export function LocalFolderRow({ connection, onOpen }: { connection: LocalFolderConnection; onOpen: () => void }) {
  return <ResourcePageSynopsisRow title={<span title={connection.name}>{connection.name}</span>} description="Read-only · this device" meta={connection.remembered ? 'Remembered' : 'Until app closes'} prefix={<FolderOpen size={15} className="shrink-0 text-ink-soft" />} onOpen={onOpen} />
}

const contextsHome: NavLocation = { kind: 'section', section: 'contexts', projectId: null, scheduleId: null }

export function LocalFolderDetail({ id, onBack, backTo }: { id: string; onBack: () => void; backTo: NavLocation | null }) {
  const state = useLocalFolderConnections()
  const connection = state.rows.find(row => row.id === id)
  if (!connection || !state.available) return <ResourceUnavailablePage title="Local folder" state={!state.available || state.status === 'ready' ? 'missing' : state.status === 'error' ? 'error' : 'loading'}
    message="This connection is not available to this account on this device. Saved snapshots remain in their conversations."
    onBack={onBack} backTo={backTo ?? contextsHome} onRetry={() => void localFolderConnections.reload()} />
  return <AtomicResourcePage data-local-folder-detail={id}>
    <header className={PAGE_HEADER_CLASS}>
      <div className="flex min-w-0 grow basis-64 items-start gap-2">
        <BackButton to={backTo ?? contextsHome} onBack={onBack} />
        <div className="min-w-0"><h1 className={`${PAGE_TITLE_CLASS} break-words [overflow-wrap:anywhere]`}>{connection.name}</h1><p className="mt-1 text-[13px] text-ink-soft">Read-only local folder · {connection.remembered ? 'Remembered on this device' : 'Access ends when the app closes'}</p></div>
      </div>
      <button type="button" disabled={state.busy || state.status !== 'ready'} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => void localFolderConnections.disconnect(id)}>Disconnect</button>
    </header>
    <LocalFolderStatus />
    <Suspense fallback={<p role="status" className="py-2 text-[12px] text-ink-soft">Loading folder browser…</p>}>
      <LocalFolderBrowser id={connection.id} name={connection.name} enabled={state.status === 'ready' && !state.busy} />
    </Suspense>
    <div className="space-y-3 text-[13px] leading-relaxed text-ink-soft">
      <p>In a conversation, choose Add context → Folder → This computer, then Attach. Refresh an attached folder explicitly to save later edits. Opening this page does not read files; listing paths and previewing a selected file are separate explicit actions.</p>
      <p>Disconnect ends future reads and cancels unsettled captures. It does not delete source files or snapshots already saved in conversations. Saved text may still be used by those conversations until you remove the attachment.</p>
    </div>
  </AtomicResourcePage>
}
