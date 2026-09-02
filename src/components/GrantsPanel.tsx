import { lazy, Suspense } from 'react'
import type { SocialEntityRef } from '../../contract/index.ts'

const GrantsPanelContent = lazy(() =>
  import('./GrantsPanelContent').then((module) => ({ default: module.GrantsPanelContent })),
)

/** Defers the low-frequency sharing editor while keeping one generic host API. */
export function GrantsPanel({
  subject,
  composing = true,
  onHeldChange,
}: {
  subject: SocialEntityRef
  composing?: boolean
  onHeldChange?: (held: boolean) => void
}) {
  return (
    <Suspense fallback={<p role="status" className="text-[11px] text-ink-faint">Loading sharing…</p>}>
      <GrantsPanelContent subject={subject} composing={composing} onHeldChange={onHeldChange} />
    </Suspense>
  )
}
