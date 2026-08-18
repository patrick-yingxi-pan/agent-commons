/** ── Pane-local resolution of the section nav bridge ─────────────────────────
 *  (universal split — the pane-locality rule, ADAPT-17.) Section pages navigate
 *  entity doors through ONE bridge — `useRelations().navigate(section, id,
 *  subId)` (owner bylines, context rows, work-item links, "View in …") — whose
 *  root implementation drives the PRIMARY controller. Hosted in a split pane,
 *  those doors must stay IN THE PANE instead: this pure mapper decides what a
 *  pane does with a bridge call, and `SectionPane` provides it as the nav
 *  override every `useRelations()` consumer below it composes in.
 *
 *  Two outcomes (total — every door stays in the pane; the equal-pages model
 *  has no primary to fall through to, and an in-pane door must carry the
 *  pane's back history, ADAPT-18):
 *  - `focus`    — the target renders inside the pane's CURRENT section: push it
 *                 onto the pane's own detail focus (back stack works). A bare
 *                 same-section jump is the empty focus — back to the root.
 *  - `retarget` — a cross-section door: rewrite the pane's leaf to the target
 *                 section, seeding the detail (`msection.seed`; a bare section
 *                 jump seeds nothing — the section root) — the pane navigates,
 *                 never another.
 *
 *  The id→detail mapping MIRRORS the root bridge (`App.navigateToSection`):
 *  projects+subId → a work item; projects → a project; scheduled → a routine;
 *  contexts → a saved context's page; commons → an OWNER profile (see
 *  OWNER_SECTION below; an agent PAGE routes through the `onOpenAgentPage`
 *  prop, never this bridge);
 *  admin → an account's detail page in the maintainer console (FWD-7 v1.1).
 *  Dependency-free and node-tested (src/lib/pane-nav.test.ts) so the mapping
 *  can't silently diverge from the root's. */
import type { SectionId } from '../types'

/** The pane's detail-focus shape (MainSplit's PaneFocusState, structurally). */
export interface PaneSeed {
  /** An addressable structural section inside a collection root (Artifacts,
   * Contexts, Models). The host section supplies the section-id namespace. */
  collectionSectionId?: string
  /** An addressable section inside a composite Project. Meaningful only with
   * `projectId`; the parent overview omits it. */
  projectSectionId?: string
  projectId?: string
  /** An addressable section inside a composite routine. Meaningful only with
   * `scheduleId`; the parent overview omits it. */
  scheduleSectionId?: string
  scheduleId?: string
  /** An addressable section inside a namespace profile. Meaningful only with
   * `ownerName`; the profile overview omits it. */
  ownerSectionId?: string
  ownerName?: string
  workItemId?: string
  /** A contribution's page under its project (the PR-page analog, workflow
   *  Phase A) — meaningful only with `projectId`, like `workItemId`. */
  contributionId?: string
  agentId?: string
  /** A reusable prompt material under Agents → Building blocks. */
  promptId?: string
  /** A built-in callable material under Agents → Building blocks. */
  toolId?: string
  contextId?: string
  adminUserId?: string
  /** A discussion's page under the discussions section (social S2). */
  discussionId?: string
  /** An artifact opened in the gallery (UI-19: the rail lists artifacts, so one
   *  has to be a PLACE — its viewer used to be component state with no address,
   *  the same gap `contextId` closed for saved contexts). */
  artifactId?: string
  /** A model provider's canonical detail page (UI-19/UI-33). */
  providerId?: string
}

/** The ONE list of detail-id keys a pane location carries — every mapping that
 *  copies these fields (a routed URL → a pane seed, a pane's live location →
 *  its canonical NavLocation, a page's focus state → its reported seed) walks
 *  THIS list, so adding a detail kind is a one-line change here instead of a
 *  hunt across three hand-copied field lists. */
export const PANE_SEED_KEYS = ['collectionSectionId', 'projectSectionId', 'projectId', 'scheduleSectionId', 'scheduleId', 'ownerSectionId', 'ownerName', 'workItemId', 'contributionId', 'agentId', 'promptId', 'toolId', 'contextId', 'adminUserId', 'discussionId', 'artifactId', 'providerId'] as const
type SeedKey = (typeof PANE_SEED_KEYS)[number]
// Compile-time lock: the key list and PaneSeed stay in lock-step — adding a
// detail id to one without the other fails typecheck here.
const _seedKeysCoverPaneSeed: keyof PaneSeed extends SeedKey ? (SeedKey extends keyof PaneSeed ? true : never) : never = true
void _seedKeysCoverPaneSeed

/** A location-ish object (a parsed RoutedView loc, a page's focus state — any
 *  shape carrying the detail keys as string | null | undefined) → the compact
 *  PaneSeed (only present, non-empty ids ride). */
export function seedOfLoc(loc: Partial<Record<SeedKey, string | null | undefined>>): PaneSeed {
  const seed: PaneSeed = {}
  for (const k of PANE_SEED_KEYS) {
    const v = loc[k]
    if (v) seed[k] = v
  }
  return seed
}

/** The inverse projection: a PaneSeed-ish location → the explicit
 *  null-carrying detail fields a section NavLocation requires. */
export function locOfSeed(seed: Partial<Record<SeedKey, string | null | undefined>>): Record<SeedKey, string | null> {
  return Object.fromEntries(PANE_SEED_KEYS.map((k) => [k, seed[k] ?? null])) as Record<SeedKey, string | null>
}

/** ── Which section HOSTS a namespace profile (D21) ───────────────────────────
 *  A profile is a SOCIAL page — the public face of a namespace — so the Commons
 *  hosts it: the section whose row reads "what your world shares" holding the
 *  page whose tagline reads "everything ‹name› shares". It lived under `agents`
 *  until 2026-08-09 for a historical reason only (profiles were first reached
 *  from the Agents hub's Discover directory), and that accident was visible in
 *  the rail: opening anyone's profile lit — and auto-expanded — Agents.
 *
 *  It is a CONSTANT rather than 24 spelled-out call sites because "which section
 *  hosts a profile" is ONE fact. Every owner door goes through
 *  `useRelations().openOwner`, which reads it; `src/lib/owner-door.test.ts` fails
 *  on a hand-rolled `navigate('<section>', name)`. */
export const OWNER_SECTION: SectionId = 'commons'

export type PaneNavTarget =
  | { kind: 'focus'; focus: PaneSeed }
  | { kind: 'retarget'; section: SectionId; seed: PaneSeed }

/** The root bridge's id→detail mapping, shared by both outcomes. Null = the
 *  call names no entity detail (a bare section jump). */
export function seedFor(section: SectionId, id?: string, subId?: string): PaneSeed | null {
  if (!id) return null
  // A projects subId is a work-item id, EXCEPT the typed `changes/<cid>` form —
  // a contribution's page (the PR-page analog). One prefix, parsed here and in
  // the root bridge only, so the 3-arg nav bridge carries both page kinds
  // without a signature change at every call site.
  if (section === 'projects' && subId?.startsWith('changes/'))
    return { projectId: id, projectSectionId: 'changes', contributionId: subId.slice('changes/'.length) }
  if (section === 'projects')
    return subId ? { projectId: id, projectSectionId: 'open-work', workItemId: subId } : { projectId: id }
  if (section === 'scheduled') return { scheduleId: id }
  if (section === 'contexts') return { contextId: id }
  if (section === 'agents') {
    if (subId === 'prompts') return { promptId: id }
    if (subId === 'tools') return { toolId: id }
    return { agentId: id }
  }
  if (section === OWNER_SECTION) return { ownerName: id }
  if (section === 'admin') return { adminUserId: id }
  if (section === 'discussions') return { discussionId: id }
  if (section === 'artifacts') return { artifactId: id }
  if (section === 'models') return { providerId: id }
  return null
}

/** What a pane hosting `current` does with a bridge call to (section, id, subId). */
export function paneNavTarget(
  current: SectionId,
  section: SectionId,
  id?: string,
  subId?: string,
): PaneNavTarget {
  const seed = seedFor(section, id, subId) ?? {}
  return section === current ? { kind: 'focus', focus: seed } : { kind: 'retarget', section, seed }
}
