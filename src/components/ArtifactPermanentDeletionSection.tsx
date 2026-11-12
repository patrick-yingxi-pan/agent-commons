import { useEffect, useRef, useState } from 'react'
import type { ArtifactDeletionPreview } from '../../contract/artifactDeletion.ts'
import type { ArtifactItem } from '../../contract/cowork.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { readArtifactDeletionPreview } from '../api/artifactDeletion.ts'
import {
  enqueueArtifactPermanentDeletion,
  heldArtifactPermanentDeletion,
} from '../controller/artifactPermanentDeletionMutations.ts'
import { useArtifactPermanentDeletionHeld } from '../controller/artifactBodyOperationHolds.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import type { MainPageSectionComponent } from './ProposalsPanel'
import { ConfirmDialog } from './ConfirmDialog'
import { InlineOperationStatus } from './InlineOperationStatus'

interface Review {
  artifact: ArtifactItem
  preview: ArtifactDeletionPreview
  sourceUserId: string | null
  generation: number
}

const count = (value: number, singular: string, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`

function deletionScope(preview: ArtifactDeletionPreview): string {
  const { versions, shares, discussions, proposals } = preview.counts
  return `Permanently delete “${preview.artifactName}”? This removes the artifact and its current content, ${count(versions, 'retained version')}, ${count(shares, 'share')}, ${count(discussions, 'artifact-only discussion')}, and ${count(proposals, 'proposal')}. Old save retries and routine runs will not recreate this artifact. Conversations and audit records stay. Existing backups may still contain this artifact. There is no Undo.`
}

/** Trash-only owner action. The server preview is loaded before consent, then
 *  both its exact scope and source row stay frozen through the one CAS request. */
export function ArtifactPermanentDeletionSection({
  Section,
  artifact,
  sourceUserId,
  onDeleted,
}: {
  Section: MainPageSectionComponent
  artifact: ArtifactItem
  sourceUserId: string | null
  onDeleted: () => void
}) {
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const deletionHeld = useArtifactPermanentDeletionHeld(artifact.id)
  const reviewOpenerRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const redirected = useRef(false)
  const scope = useRef({ artifactId: artifact.id, sourceUserId, generation: accountGeneration() })
  scope.current = { artifactId: artifact.id, sourceUserId, generation: accountGeneration() }

  useEffect(() => {
    mounted.current = true
    const unsubscribe = onAccountSwitch(() => {
      setReading(false)
      setReview(null)
      setSubmitting(false)
      setNotice('The account changed. Review the artifact in the current account before deleting it.')
    })
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    setReading(false)
    setReview(null)
    setSubmitting(false)
    setNotice('')
  }, [artifact.id, sourceUserId])

  useEffect(() => {
    const held = heldArtifactPermanentDeletion(artifact.id)
    if (!held) return
    const issuedGeneration = accountGeneration()
    let current = true
    void held.result.then((outcome) => {
      if (current && outcome === 'applied' && !redirected.current && mounted.current &&
        accountGeneration() === issuedGeneration && scope.current.artifactId === artifact.id &&
        scope.current.sourceUserId === sourceUserId) {
        redirected.current = true
        onDeleted()
      }
    })
    return () => { current = false }
  }, [artifact.id, sourceUserId, deletionHeld, onDeleted])

  const loadReview = async () => {
    if (reading || submitting) return
    const frozenArtifact = structuredClone(artifact)
    const source = sourceUserId
    const issued = { artifactId: frozenArtifact.id, sourceUserId: source, generation: accountGeneration() }
    setReading(true)
    setNotice('')
    try {
      const preview = await readArtifactDeletionPreview(frozenArtifact.id, source)
      if (!mounted.current || accountGeneration() !== issued.generation || scope.current.artifactId !== issued.artifactId ||
        scope.current.sourceUserId !== issued.sourceUserId) return
      if (preview.lifecycleRevision !== (frozenArtifact.lifecycleRevision ?? 0) ||
        preview.artifactName !== frozenArtifact.name || preview.lifecycleRevision % 2 !== 1) {
        setNotice('This artifact changed after Trash loaded. Reload its Trash details before reviewing deletion.')
        return
      }
      setReview({ artifact: frozenArtifact, preview: structuredClone(preview), sourceUserId: source, generation: issued.generation })
    } catch {
      if (mounted.current && accountGeneration() === issued.generation && scope.current.artifactId === issued.artifactId) {
        setNotice('Couldn’t load the deletion review. Nothing was deleted; retry to load a fresh preview.')
      }
    } finally {
      if (mounted.current && accountGeneration() === issued.generation && scope.current.artifactId === issued.artifactId) setReading(false)
    }
  }

  const confirmDelete = async () => {
    if (!review || submitting || review.artifact.id !== artifact.id || review.generation !== accountGeneration()) return
    setSubmitting(true)
    setReview(null)
    const submittedScope = { ...scope.current }
    const outcome = await enqueueArtifactPermanentDeletion(review.artifact, review.preview, review.sourceUserId)
    if (!mounted.current || scope.current.artifactId !== submittedScope.artifactId ||
      scope.current.sourceUserId !== submittedScope.sourceUserId || accountGeneration() !== submittedScope.generation) return
    setSubmitting(false)
    if (outcome === 'applied' && !redirected.current) {
      redirected.current = true
      onDeleted()
    }
    else setNotice('Deletion was not confirmed. Dismiss its recovery notice to check saved state before reviewing again.')
  }

  return <Section title="Delete permanently" summary="Irreversible removal" defaultFolded>
    <p className="text-[12px] leading-relaxed text-ink-soft">Load the server’s deletion preview first. The confirmation names the exact retained material and the recovery that remains.</p>
    {notice && <div data-artifact-deletion-review-notice="true"><InlineOperationStatus
      tone="alert"
      message={notice}
      action={notice.startsWith('Couldn’t load') ? { label: 'Retry preview', onClick: () => { void loadReview() } } : undefined}
    /></div>}
    <button
      ref={reviewOpenerRef}
      type="button"
      data-artifact-permanent-delete-open="true"
      disabled={reading || submitting || deletionHeld}
      aria-busy={reading || submitting || deletionHeld}
      className={`${SECONDARY_BUTTON_CLASS} mt-3 px-3 py-1.5 text-[12px] disabled:opacity-45`}
      onClick={() => { void loadReview() }}
    >{deletionHeld ? 'Deletion awaiting confirmation' : reading ? 'Loading deletion preview…' : 'Delete permanently…'}</button>
    {review && <ConfirmDialog
      returnFocus={reviewOpenerRef}
      title="Delete artifact permanently?"
      body={deletionScope(review.preview)}
      confirmLabel="Delete permanently"
      onCancel={() => setReview(null)}
      onConfirm={() => { void confirmDelete() }}
    />}
  </Section>
}
