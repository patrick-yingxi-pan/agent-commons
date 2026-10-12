import { lazy, Suspense, type ComponentProps } from 'react'
import type { RelationActionCard } from './RelationActionCard.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const Card = lazy(() => import('./RelationActionCard.tsx').then(module => ({ default: module.RelationActionCard })))
const SHELL_CLASS = 'mt-2.5 space-y-2 rounded-xl border border-line bg-panel-2/30 p-3 text-[12px] leading-relaxed text-ink-soft'

/** Proposal review is conditional transcript content. Failure cannot offer a
 * decision or imply that the proposal was approved, declined or executed. */
export function DeferredRelationActionCard(props: ComponentProps<typeof RelationActionCard>) {
  return <DeferredLoadBoundary fallback={<div role="alert" data-relation-action-load-error className={SHELL_CLASS}>
    <p>Couldn’t load proposal review. No decision was made.</p>
    <p>Copy unsent workspace text before reloading, then review the latest proposal.</p>
    <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px]`} onClick={() => window.location.reload()}>Reload proposal review</button>
  </div>}>
    <Suspense fallback={<div role="status" data-relation-action-loading className={SHELL_CLASS}>Loading proposal review…</div>}>
      <Card {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
