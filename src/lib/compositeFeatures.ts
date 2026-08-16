/** The resource-scoped capabilities a composite root projects in BOTH places.
 *
 * The rail and main page are different-density views of one resource, so this
 * catalog names capabilities rather than components. A primary action may be a
 * full soft button in the page header and a row in the rail's overflow menu;
 * search may be a field on the page and a command that lands in that field from
 * the rail. The capability is one even when its projection adapts.
 *
 * Projection mechanics stay out: the rail's eight-row "Show all" cap and its
 * tree chevrons exist only because the rail is narrow. They do not change the
 * resource and therefore are not features the page has to imitate.
 */
import type { SectionId } from '../types'

export type CompositeCommandKind = 'primary-action' | 'focus-search'

export interface CompositeFeatureSpec {
  primaryAction?: string
  search?: string
  /** The page contains structural sections and therefore supports bulk fold. */
  fold?: boolean
}

/** Complete over SectionId so a new rail root cannot silently skip the audit. */
export const COMPOSITE_FEATURES: Record<SectionId, CompositeFeatureSpec> = {
  commons: { fold: true },
  projects: { primaryAction: 'New project', search: 'Search projects', fold: true },
  artifacts: { primaryAction: 'New artifact', search: 'Search artifacts', fold: true },
  contexts: { primaryAction: 'Add context', search: 'Search contexts', fold: true },
  models: { primaryAction: 'New provider', fold: true },
  agents: { primaryAction: 'New agent', fold: true },
  scheduled: { primaryAction: 'New routine', search: 'Search routines', fold: true },
  discussions: { fold: true },
  messages: { fold: true },
  notifications: { fold: true },
  sessions: { primaryAction: 'New session' },
  dispatch: { primaryAction: 'New dispatch', fold: true },
  customize: {},
  admin: { fold: true },
}

export interface CompositeCommand {
  revision: number
  section: SectionId
  kind: CompositeCommandKind
}

let pendingCommand: CompositeCommand | null = null
let commandRevision = 0
const commandListeners = new Set<() => void>()

export function compositeCommandSnapshot(): CompositeCommand | null {
  return pendingCommand
}

export function subscribeCompositeCommand(listener: () => void): () => void {
  commandListeners.add(listener)
  return () => commandListeners.delete(listener)
}

/** A rail command is pending until the focused matching page consumes it.
 * This lets navigation and invocation happen in one click without racing the
 * new page's mount. */
export function requestCompositeCommand(section: SectionId, kind: CompositeCommandKind): void {
  pendingCommand = { revision: ++commandRevision, section, kind }
  for (const listener of [...commandListeners]) listener()
}

export function consumeCompositeCommand(revision: number): void {
  if (pendingCommand?.revision !== revision) return
  pendingCommand = null
  for (const listener of [...commandListeners]) listener()
}

export interface CompositeFoldSignal {
  revision: number
  section: SectionId
  /** true opens every structural section; false collapses every one. */
  expanded: boolean
}

let foldSignal: CompositeFoldSignal | null = null
let foldRevision = 0
const foldListeners = new Set<() => void>()

export function compositeFoldSnapshot(): CompositeFoldSignal | null {
  return foldSignal
}

export function subscribeCompositeFold(listener: () => void): () => void {
  foldListeners.add(listener)
  return () => foldListeners.delete(listener)
}

/** One bulk-disclosure request, observed by the main page and its rail branch. */
export function requestCompositeFold(section: SectionId, expanded: boolean): void {
  foldSignal = { revision: ++foldRevision, section, expanded }
  for (const listener of [...foldListeners]) listener()
}
