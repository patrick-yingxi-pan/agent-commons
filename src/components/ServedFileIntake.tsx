import { useEffect, useRef, useState } from 'react'
import { Check, FileText } from 'lucide-react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { readFsSnapshot } from '../api/fsReads.ts'
import { retryFsCatalog } from '../api/fsReads.ts'
import { useFsCatalog, fsContentUrl } from '../api/fsHooks.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import { IMAGE_ORIGINAL_PRIVACY_COPY } from '../lib/imageOriginalDownload.ts'
import { fsReadPhase } from '../lib/fsReadState.ts'
import { useRecentIds } from '../lib/recents'
import { documentFormatForName, type ServedTextSnapshot } from '../../contract/servedTextSnapshot.ts'
import { isServedImageFileName } from '../../contract/servedImageSnapshot.ts'
import { fsRecentKey, parseFsRecentKey } from '../../contract/fs.ts'
import { isLocalTextFileName } from '../../contract/localTextFile.mjs'
import type { FsFileEntry, FsPhotoEntry, FsSource, AddedContext } from '../types'
import { RecentOverflowList } from './RecentOverflowList'
import { FsReadNotice } from './FsReadNotice.tsx'
import type { PhotoThumb as PhotoThumbComponent } from './PhotoThumb'
import { OptionRow } from './ContextOptionRow.tsx'

export function ServedFileIntake({
  kind,
  source,
  onAdd,
  maxRows,
  addedIds,
  onPreviewOnly,
  PhotoThumb,
}: {
  kind: 'files' | 'photos'
  source: FsSource
  onAdd: (ctx: AddedContext) => void
  maxRows: number
  addedIds: readonly string[]
  onPreviewOnly: (entry: FsFileEntry | FsPhotoEntry) => void
  PhotoThumb: typeof PhotoThumbComponent
}) {
  const [read, setRead] = useState<{ entry: FsFileEntry | FsPhotoEntry; status: 'loading' | 'error'; error?: string } | null>(null)
  const catalog = useFsCatalog(source.id)
  const recentKeys = useRecentIds('files')
  const intake = useRef<AbortController | null>(null)
  const imageIntake = useRef<{ path: string; capture: ReturnType<typeof import('../controller/servedImageCapture.ts').createServedImageCapture> } | null>(null)
  useEffect(() => {
    const cancel = () => { intake.current?.abort(); intake.current = null; imageIntake.current = null }
    const unsubscribe = onAccountSwitch(() => { cancel(); setRead(null) })
    return () => { unsubscribe(); cancel() }
  }, [])

  const take = async (entry: FsFileEntry | FsPhotoEntry) => {
    if (intake.current) return
    const controller = new AbortController()
    const issuedAccount = accountGeneration()
    intake.current = controller
    setRead({ entry, status: 'loading' })
    try {
      if (isServedImageFileName(entry.id)) {
        const { createServedImageCapture } = await import('../controller/servedImageCapture.ts')
        if (controller.signal.aborted || issuedAccount !== accountGeneration()) return
        if (imageIntake.current?.path !== entry.id) {
          imageIntake.current = { path: entry.id, capture: createServedImageCapture(source.id, entry.id, crypto.randomUUID()) }
        }
        const imageSnapshot = await imageIntake.current.capture(controller.signal)
        if (controller.signal.aborted || issuedAccount !== accountGeneration()) return
        setRead(null)
        onAdd({ kind, attachments: [{ id: fsRecentKey(source.id, entry.id), label: entry.name, kind: kind === 'photos' ? 'photo' : 'file', source, imageSnapshot }] })
        imageIntake.current = null
        return
      }
      imageIntake.current = null
      const snapshot: ServedTextSnapshot = documentFormatForName(entry.id)
        ? await import('../controller/servedDocumentCapture.ts').then(({ captureServedDocument }) =>
          captureServedDocument(source.id, entry.id, crypto.randomUUID(), controller.signal))
        : await readFsSnapshot(source.id, entry.id, controller.signal)
      if (controller.signal.aborted || issuedAccount !== accountGeneration()) return
      if (snapshot.sourceId !== source.id || snapshot.path !== entry.id) throw new Error('Snapshot did not match the selected file.')
      setRead(null)
      onAdd({ kind: 'files', attachments: [{
        id: fsRecentKey(source.id, entry.id),
        label: entry.name,
        kind: 'file',
        source,
        textSnapshot: snapshot,
      }] })
    } catch (error) {
      if (!controller.signal.aborted && issuedAccount === accountGeneration()) {
        setRead({ entry, status: 'error', error: error instanceof Error ? error.message : undefined })
      }
    } finally {
      if (intake.current === controller) intake.current = null
    }
  }

  const onCapture = (entry: FsFileEntry | FsPhotoEntry) => { void take(entry) }
  const onSelect = (entry: FsFileEntry | FsPhotoEntry) => {
    if (kind === 'photos' || isServedImageFileName(entry.id) || documentFormatForName(entry.id) || isLocalTextFileName(entry.name)) onCapture(entry)
    else onPreviewOnly(entry)
  }
  const notice = read && <div data-fs-file-read={read.status} role={read.status === 'error' ? 'alert' : 'status'} aria-busy={read.status === 'loading'} className="break-words px-1 py-2 text-[12px] text-ink-soft">
    {read.status === 'loading' ? <p>Reading {read.entry.name}… Close this picker or choose another source to cancel.</p> : <>
      <p className="break-words text-danger-text">Could not read {read.entry.name}. Nothing was attached.</p>
      {read.error && <p className="mt-1 break-words">{read.error}</p>}
      <button type="button" onClick={() => void take(read.entry)} className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`}>Retry</button>
    </>}
  </div>

  const disabled = read?.status === 'loading'
  const files = catalog.data?.files ?? []
  const photos = catalog.data?.photos ?? []
  const phase = fsReadPhase(catalog.status, (kind === 'photos' ? photos : files).length > 0)
  const recent = new Set(recentKeys.map(parseFsRecentKey).filter((key) => key?.sourceId === source.id).map((key) => key!.entryId))
  const description = kind === 'photos'
    ? `Images up to 8 MB attach as saved PNG copies of the first frame, resized to at most 2,000 pixels per side. Originals are retained privately. ${IMAGE_ORIGINAL_PRIVACY_COPY} Use Refresh in Photos for later changes.`
    : 'Text, documents and images attach as saved copies: text up to 64 KB, or PDF, DOCX, XLSX, PPTX and images up to 8 MB. Use Refresh in Files for later changes.'

  return <>
    <p className="px-1 py-2 text-[11px] leading-snug text-ink-soft">{description}</p>
    <fieldset disabled={disabled}>
      {phase !== 'ready' ? <FsReadNotice phase={phase} label={kind} onRetry={() => retryFsCatalog(source.id)} /> : kind === 'photos' ? (
        <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
          {photos.map((photo) => {
            const added = addedIds.includes(fsRecentKey(source.id, photo.id))
            return <PhotoThumb key={photo.id} id={photo.id} src={fsContentUrl(source.id, photo.id)} title={photo.name} onClick={added ? undefined : () => onCapture(photo)} disabled={disabled} className={`aspect-square rounded-lg ring-1 transition ${added ? 'ring-2 ring-ok' : 'ring-black/5 hover:opacity-80'}`}>
              {added && <span className="absolute inset-0 flex items-center justify-center bg-black/35"><Check size={18} className="text-on-solid" strokeWidth={3} /></span>}
            </PhotoThumb>
          })}
        </div>
      ) : (
        <RecentOverflowList maxRows={Math.max(2, maxRows - 1)} moreLabel="More files" rows={[...files.filter((file) => recent.has(file.id)), ...files.filter((file) => !recent.has(file.id))].map((file) => ({
          key: file.id,
          node: <OptionRow icon={<FileText size={16} />} label={file.name} meta={`${file.ext ? file.ext.toUpperCase() + ' · ' : ''}${formatSize(file.size)}`} added={addedIds.includes(fsRecentKey(source.id, file.id))} disabled={disabled} onClick={() => onSelect(file)} />,
        }))} />
      )}
    </fieldset>
    {notice}
  </>
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
