import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactHistoryPage, ArtifactHistoryVersionMetadata } from '../../contract/artifactHistory.ts'
import type { ArtifactKind } from '../types'
import {
  invalidateArtifactHistory,
  invalidateArtifactHistoryVersion,
  useArtifactHistory,
  useArtifactHistoryVersion,
} from '../api/artifactHistory.ts'
import { ArtifactBodyView } from './artifactPreview'
import { ConfirmDialog } from './ConfirmDialog'
import { InlineOperationStatus } from './InlineOperationStatus'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import { LEDGER_LIST_CLASS } from '../lib/ledger'
import {
  enqueueArtifactHistoryRestore,
  takeDismissedArtifactHistoryRestoreFailure,
  useArtifactHistoryRestoreStatus,
} from '../controller/artifactHistoryMutations.ts'
import { isArtifactHistoryRestoreHeld } from '../controller/artifactBodyOperationHolds.ts'
import { artifactHistoryNextCursor, flattenArtifactHistoryPages, mergeArtifactHistoryPage } from '../api/artifactHistoryPages.ts'
import { accountGeneration } from '../api/account.ts'

interface Props {
  artifactId: string
  artifactName: string
  artifactKind: ArtifactKind
  sourceUserId: string | null
  allowRestore: boolean
  restoreBlocked?: boolean
}

interface RestoreReview {
  targetRevision: number
  expectedRevision: number
}

function reasonLabel(version: ArtifactHistoryVersionMetadata): string {
  if (version.reason === 'restore') return `Restored from version ${version.restoredFromRevision}`
  return version.reason === 'baseline' ? 'Baseline' : 'Edited'
}

function savedTime(value: string | null): string {
  if (!value) return 'time unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function ArtifactHistoryPanel({
  artifactId,
  artifactName,
  artifactKind,
  sourceUserId,
  allowRestore,
  restoreBlocked = false,
}: Props) {
  const latestQuery = useArtifactHistory(artifactId)
  const [olderCursor, setOlderCursor] = useState<number | undefined>()
  const olderQuery = useArtifactHistory(artifactId, olderCursor, olderCursor !== undefined)
  const [pages, setPages] = useState<ArtifactHistoryPage[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number>()
  const [review, setReview] = useState<RestoreReview | null>(null)
  const [notice, setNotice] = useState('')
  const restoreStatus = useArtifactHistoryRestoreStatus()
  const restoreHeld = isArtifactHistoryRestoreHeld(artifactId)
  const blocked = restoreBlocked || restoreHeld || restoreStatus.busy || Boolean(restoreStatus.error)
  const scope = useRef({ artifactId, sourceUserId })
  scope.current = { artifactId, sourceUserId }
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    setPages([])
    setSelectedRevision(undefined)
    setReview(null)
    setNotice('')
  }, [artifactId, sourceUserId])

  useEffect(() => {
    if (latestQuery.data) setPages((existing) => mergeArtifactHistoryPage(existing, latestQuery.data!, true))
  }, [latestQuery.data])

  useEffect(() => {
    if (olderCursor !== undefined && olderQuery.data) {
      setPages((existing) => mergeArtifactHistoryPage(existing, olderQuery.data!, false))
      setOlderCursor(undefined)
    }
  }, [olderCursor, olderQuery.data])

  const versions = useMemo(() => flattenArtifactHistoryPages(pages), [pages])
  const currentRevision = latestQuery.data?.currentRevision ?? pages[0]?.currentRevision
  const selectedQuery = useArtifactHistoryVersion(artifactId, selectedRevision)
  const selectedVersion = selectedQuery.data?.version
  const olderCursorAvailable = artifactHistoryNextCursor(pages)
  const hasOlder = olderCursorAvailable !== undefined

  const reload = (message = '') => {
    setNotice(message)
    setPages([])
    setSelectedRevision(undefined)
    setOlderCursor(undefined)
    invalidateArtifactHistory(artifactId)
  }

  const retrySelected = () => {
    if (selectedRevision !== undefined) invalidateArtifactHistoryVersion(artifactId, selectedRevision)
  }

  const confirmRestore = async () => {
    if (!review) return
    if (blocked || !allowRestore) {
      setReview(null)
      reload('Another body or Trash operation started while you were reviewing. Finish it, then reload history before restoring a version.')
      return
    }
    if (latestQuery.status === 'loading' || latestQuery.data?.currentRevision !== review.expectedRevision) {
      setReview(null)
      reload('This artifact changed after you reviewed this restore. Close this confirmation and load history again before reviewing it.')
      return
    }
    const target = review.targetRevision
    const expected = review.expectedRevision
    const submittedScope = { ...scope.current, generation: accountGeneration() }
    setReview(null)
    const outcome = await enqueueArtifactHistoryRestore(artifactId, target, expected, sourceUserId)
    if (!mounted.current || scope.current.artifactId !== submittedScope.artifactId ||
      scope.current.sourceUserId !== submittedScope.sourceUserId || accountGeneration() !== submittedScope.generation) return
    if (outcome === 'applied') {
      setNotice('')
      setSelectedRevision(expected + 1)
      invalidateArtifactHistory(artifactId)
    } else if (outcome === 'discarded') {
      const failure = takeDismissedArtifactHistoryRestoreFailure(artifactId)
      setNotice(failure.includes('changed before the restore')
        ? 'This artifact changed before the restore. Reload history before reviewing another restore.'
        : 'Restore was not confirmed. Reload history to review the current saved state.')
    }
  }

  const exactReviewIsCurrent = Boolean(review && currentRevision === review.expectedRevision && latestQuery.status !== 'loading')

  return (
    <div className="space-y-3" data-artifact-history={artifactId} data-artifact-history-current-revision={currentRevision}>
      <p className="text-[12px] leading-relaxed text-ink-soft">History begins with the earliest retained baseline; changes before history was captured are not available. Saved versions are read-only, and opening history does not change the current content.</p>
      {notice && <div className="space-y-2" data-artifact-history-notice="true"><InlineOperationStatus tone="alert" message={notice} /><button type="button" data-artifact-history-reload="true" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => reload()}>Reload history</button></div>}
      {latestQuery.status === 'error' && !latestQuery.data ? (
        <InlineOperationStatus tone="alert" message="Couldn’t load version history." action={{ label: 'Retry history load', onClick: reload }} />
      ) : latestQuery.status === 'loading' && !latestQuery.data ? (
        <p role="status" className="text-[12px] text-ink-faint">Loading saved versions…</p>
      ) : versions.length === 0 ? (
        <p className="rounded-lg border border-line bg-panel-2/50 p-3 text-[12px] text-ink-faint">No earlier versions have been recorded. Your current content will be retained when it changes.</p>
      ) : (
        <>
          <div className={LEDGER_LIST_CLASS} aria-label="Saved artifact versions">
            {versions.map((version) => {
              const isCurrent = version.revision === currentRevision
              const label = savedTime(version.savedAt)
              return <button
                key={version.revision}
                type="button"
                data-artifact-history-version={version.revision}
                aria-label={`View revision ${version.revision} · ${reasonLabel(version)} · ${label}`}
                aria-pressed={selectedRevision === version.revision}
                title={`Version ${version.revision} · ${reasonLabel(version)} · ${label}`}
                className={`flex w-full min-w-0 items-start justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-panel-2 ${selectedRevision === version.revision ? 'bg-panel-2' : 'bg-surface'}`}
                onClick={() => { setSelectedRevision(version.revision); setNotice('') }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-ink">Version {version.revision}{isCurrent ? ' · Current version' : ''}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">{reasonLabel(version)} · {label}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">{selectedRevision === version.revision ? 'Selected' : 'View'}</span>
              </button>
            })}
          </div>
          {hasOlder && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} disabled={olderQuery.status === 'loading'} onClick={() => {
            if (olderQuery.status === 'error') { invalidateArtifactHistory(artifactId); return }
            setOlderCursor(olderCursorAvailable)
          }}>{olderQuery.status === 'error' ? 'Retry older history' : olderQuery.status === 'loading' ? 'Loading older versions…' : 'Load older'}</button>}
          {olderQuery.status === 'error' && <p role="alert" className="text-[12px] text-danger">Couldn’t load older versions. Try again.</p>}
          {latestQuery.status === 'error' && latestQuery.data && <InlineOperationStatus tone="alert" message="Couldn’t refresh current history." action={{ label: 'Reload history', onClick: reload }} />}
        </>
      )}

      {selectedRevision !== undefined && (
        <section className="rounded-lg border border-line bg-panel-2/40 p-3" aria-label={`Version ${selectedRevision} preview`}>
          {selectedQuery.status === 'error' && !selectedVersion ? (
            <InlineOperationStatus tone="alert" message={`Couldn’t load revision ${selectedRevision}.`} action={{ label: 'Retry version load', onClick: retrySelected }} />
          ) : selectedQuery.status === 'loading' && !selectedVersion ? (
            <p role="status" className="text-[12px] text-ink-faint">Loading version {selectedRevision}…</p>
          ) : selectedVersion ? (
            <div data-artifact-history-body>
              <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold text-ink">Version {selectedVersion.revision} · {reasonLabel(selectedVersion)}</h3>
                  {selectedVersion.revision === currentRevision && <p className="mt-0.5 text-[11px] text-cap-ok">Current version</p>}
                </div>
                {allowRestore && selectedVersion.revision !== currentRevision && <button
                  type="button"
                  disabled={blocked || currentRevision === undefined}
                  title={blocked ? 'Finish or dismiss the current body operation first' : undefined}
                  className={`${SECONDARY_BUTTON_CLASS} shrink-0 px-3 py-1.5 text-[12px]`}
                  onClick={() => {
                    if (currentRevision === undefined) return
                    setReview({ targetRevision: selectedVersion.revision, expectedRevision: currentRevision })
                  }}
                >Restore version {selectedVersion.revision}</button>}
              </div>
              <ArtifactBodyView kind={artifactKind} name={artifactName} size="full" bodyOverride={selectedVersion.body} />
            </div>
          ) : null}
        </section>
      )}

      {review && <ConfirmDialog
        title="Restore artifact version"
        body={`Restore version ${review.targetRevision} of “${artifactName}”? This creates a new saved version; it does not erase the versions after it. The restore is based on current version ${review.expectedRevision}.${exactReviewIsCurrent ? '' : ' This view changed after review; the restore will be refused until you reload history.'}`}
        confirmLabel="Restore version"
        onCancel={() => setReview(null)}
        onConfirm={() => { void confirmRestore() }}
      />}
      {restoreStatus.activeResourceId === artifactId && restoreStatus.error && <span data-artifact-history-restore-held="true" className="sr-only">Restore outcome needs attention</span>}
      {restoreStatus.activeResourceId === artifactId && !restoreStatus.error && restoreStatus.busy && <span data-artifact-history-restore-pending="true" className="sr-only">Restore is pending</span>}
    </div>
  )
}
