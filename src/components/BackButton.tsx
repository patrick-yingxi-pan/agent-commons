/** ── The one back control (the back-history rule, ADAPT-18) ──────────────────
 *  Every page opened by clicking WITHIN a page carries this affordance back to
 *  the page that opened it — the detail pages (inline on the title line, the
 *  pageHeader primitive), the hub pages (through PageHeader via PageBackContext,
 *  when carried history exists), and a conversation's title bar (a session
 *  opened from a page). One component so the cue can't drift: a circular ghost
 *  arrow (PAGE_BACK_CLASS), the destination NAMED in the tooltip/aria-label,
 *  resolving live project / routine names and a session's carried title
 *  (lib/nav.ts resolveBackLabel). */
import { createContext } from 'react'
import { ArrowLeft } from 'lucide-react'
import { PAGE_BACK_CLASS } from '../lib/pageHeader'
import { resolveBackLabel, type NavLocation } from '../lib/nav'
import { useRelations } from '../controller/useRelations'
import { useSchedules } from '../api'

export function BackButton({ to, onBack }: { to: NavLocation | null; onBack: () => void }) {
  const projects = useRelations().allProjects()
  const schedules = useSchedules().data ?? []
  const label = resolveBackLabel(to, {
    project: Object.fromEntries(projects.map((p) => [p.id, p.name])),
    schedule: Object.fromEntries(schedules.map((s) => [s.id, s.name])),
  })
  return (
    <button onClick={onBack} title={`Back to ${label}`} aria-label={`Back to ${label}`} className={PAGE_BACK_CLASS}>
      <ArrowLeft size={17} className="shrink-0" />
    </button>
  )
}

/** The pane's back state for pages that render through the shared PageHeader
 *  (the hub/list pages): non-null when history exists — the header leads with
 *  the back control. Detail pages receive backTo/onBack as props and render
 *  BackButton directly; SectionView provides the value for its whole body. */
export const PageBackContext = createContext<{ to: NavLocation | null; onBack: () => void } | null>(null)
