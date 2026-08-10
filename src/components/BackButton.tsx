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
import { useAgents, useMyDiscussions, useProviders, useSavedContexts, useSchedules } from '../api'
import { discussionTitle } from '../../contract/social.ts'

const byId = <T,>(rows: T[], id: (r: T) => string, name: (r: T) => string): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [id(r), name(r)]))

export function BackButton({ to, onBack }: { to: NavLocation | null; onBack: () => void }) {
  const rel = useRelations()
  // Every registry a detail page can be, read LIVE (UI-12) — the destination
  // must be NAMED, and the old three-branch label silently answered "Back to
  // Discussions" for one specific thread. Affordable in a component this
  // common because `src/api` is a shared cache: these are one small list GET
  // each per app lifetime, not per back button.
  const schedules = useSchedules().data ?? []
  const discussions = useMyDiscussions().data ?? []
  const contexts = useSavedContexts().data?.contexts ?? []
  const providers = useProviders().data ?? []
  const agents = useAgents().data ?? []
  const label = resolveBackLabel(to, {
    project: byId(rel.allProjects(), (p) => p.id, (p) => p.name),
    schedule: byId(schedules, (s) => s.id, (s) => s.name),
    artifact: byId(rel.allArtifacts(), (a) => a.id, (a) => a.name),
    // A thread's opening post IS its title — through the shared trimmer, so the
    // back label can't cut mid-word where the thread page doesn't.
    discussion: byId(discussions, (d) => d.id, (d) => discussionTitle(d.posts[0]?.body, 40)),
    context: byId(contexts, (c) => c.id, (c) => c.label),
    provider: byId(providers, (p) => p.id, (p) => p.label),
    agent: byId(agents, (a) => a.id, (a) => a.label),
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
