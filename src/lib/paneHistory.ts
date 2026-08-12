/** ── Pane back history — the back-history rule (ADAPT-18) ────────────────────
 *  Every page opened by clicking WITHIN a page carries a back affordance to
 *  the page that opened it — across section boundaries and across the
 *  page↔conversation line, not just inside one section's detail stack. The
 *  mechanism: a pane's content carries a `back` stack of `PaneLoc` entries
 *  (src/lib/mainSplit.ts). Doors that originate INSIDE pane content — a
 *  cross-section retarget, a session row, a title-bar breadcrumb, a relation
 *  card's "View in …" — replace the pane with the target *plus the origin
 *  pushed* (`pushedBack`); the landing page's back affordance pops the stack
 *  (`contentForLoc`). Chrome doors (the rail, the palette) route through the
 *  shell without a push — deliberate top-level navigation resets history,
 *  GitHub's top-nav rule, with no exceptions. The notification inbox needed one
 *  for an afternoon and instead became a PAGE (2026-08-08), so its rows are
 *  in-page doors like any other and what they open carries the inbox home.
 *
 *  Browser Back/Forward follow the same per-page model (`planPop`): the
 *  address popstate moved to first tries the focused pane's own back top (an
 *  in-page hop — pop it, deeper history preserved), then a pane already
 *  showing the address (a focus hop — refocus it, never clobber the focused
 *  pane with a copy), then a plain focused-pane retarget (a fresh landing).
 *
 *  Pure + dependency-free beyond the split vocabulary, so
 *  src/lib/pane-history.test.ts locks the model without a DOM. */
import type { NavLocation } from './nav.ts'
import { locOfSeed, seedOfLoc, PANE_SEED_KEYS, type PaneSeed } from './paneNav.ts'
import { paneLocationPath, type MainPaneContent, type MainSplitNode, type PaneLoc } from './mainSplit.ts'
import { panes, type SplitNode } from './splitFrame.ts'

/** The carried stack's cap — drop the oldest beyond this (a bound on the
 *  persisted blob, generous beyond any real navigation chain). */
export const BACK_MAX = 25

const sameSeed = (a?: PaneSeed, b?: PaneSeed): boolean =>
  PANE_SEED_KEYS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null))

/** Two entries are the same PAGE (identity only — a session's carried title is
 *  display chrome, the nav.ts `sameLocation` rule). */
export function samePaneLoc(a: PaneLoc, b: PaneLoc): boolean {
  if (a.kind === 'msession' && b.kind === 'msession') return a.id === b.id
  if (a.kind === 'msection' && b.kind === 'msection')
    return a.id === b.id && (a.sub ?? null) === (b.sub ?? null) && sameSeed(a.seed, b.seed)
  return false
}

const compactSeed = (seed: PaneSeed | undefined): PaneSeed | undefined => {
  if (!seed) return undefined
  const c = seedOfLoc(seed)
  return Object.keys(c).length ? c : undefined
}

/** The page a pane currently shows, as a back entry. A section pane's REPORTED
 *  live location (`at`) wins over the door seed (same rule as the URL,
 *  paneLocationPath); a context-panel pane addresses as its OWNING
 *  conversation (a panel is not a page). `sessionTitle` resolves the carried
 *  title at push time — "resolved when you leave it" (nav.ts). */
export function paneLocOf(c: MainPaneContent, sessionTitle?: (id: string) => string): PaneLoc {
  if (c.kind === 'msession' || c.kind === 'context-panel') {
    const id = c.kind === 'msession' ? c.id : c.sessionId
    const title = sessionTitle?.(id)
    return { kind: 'msession', id, ...(title ? { title } : {}) }
  }
  const sub = c.at ? (c.at.sub ?? null) : (c.sub ?? null)
  const seed = compactSeed(c.at ? seedOfLoc(c.at) : c.seed)
  return { kind: 'msection', id: c.id, ...(sub ? { sub } : {}), ...(seed ? { seed } : {}) }
}

/** The full history chain a door leaving `c` hands its target: the carried
 *  cross-page stack, then the section pane's reported in-section stack (the
 *  detail pages behind the live one — without it a cross-section door would
 *  amputate them), then the live page itself. Adjacent duplicates collapse
 *  (the nav.ts pushLocation rule) and the chain is capped at BACK_MAX. */
export function pushedBack(c: MainPaneContent, sessionTitle?: (id: string) => string): PaneLoc[] {
  const carried = c.kind === 'context-panel' ? [] : (c.back ?? [])
  const sub = c.kind === 'msection' ? (c.at ? (c.at.sub ?? null) : (c.sub ?? null)) : null
  const hist: PaneLoc[] =
    c.kind === 'msection'
      ? (c.hist ?? []).map((seed) => {
          const s = compactSeed(seed)
          return { kind: 'msection' as const, id: c.id, ...(sub ? { sub } : {}), ...(s ? { seed: s } : {}) }
        })
      : []
  const out: PaneLoc[] = []
  for (const loc of [...carried, ...hist, paneLocOf(c, sessionTitle)]) {
    if (!out.length || !samePaneLoc(out[out.length - 1], loc)) out.push(loc)
  }
  return out.slice(-BACK_MAX)
}

/** The ONE push funnel: the target content a pane-originated door lands with —
 *  the origin's whole chain on its back stack. A re-click of the page already
 *  shown (the active run in the run switcher) must not push a self-loop: the
 *  live entry is dropped and the history stands as it was. Shared by
 *  PaneBody's `fillWith` and the push-flagged `routeToFocused`, so the two
 *  halves of the funnel can't drift. */
export function withBackPush(
  origin: MainPaneContent,
  target: MainPaneContent,
  sessionTitle?: (id: string) => string,
): MainPaneContent {
  if (target.kind === 'context-panel') return target // a panel is not a page — carries no history
  const back = pushedBack(origin, sessionTitle)
  const rest = samePaneLoc(paneLocOf(target), back[back.length - 1]) ? back.slice(0, -1) : back
  return rest.length ? { ...target, back: rest } : target
}

/** Rebuild pane content from a back entry plus the remaining stack — what the
 *  back affordance fills the pane with (and what popstate's pop arm applies). */
export function contentForLoc(loc: PaneLoc, back: PaneLoc[]): MainPaneContent {
  if (loc.kind === 'msession') return { kind: 'msession', id: loc.id, ...(back.length ? { back } : {}) }
  return {
    kind: 'msection',
    id: loc.id,
    ...(loc.sub !== undefined ? { sub: loc.sub } : {}),
    ...(loc.seed ? { seed: loc.seed } : {}),
    ...(back.length ? { back } : {}),
  }
}

/** A back entry as the nav model's NavLocation — `resolveBackLabel`'s input,
 *  so the affordance NAMES its destination from the same live-name resolution
 *  every back button uses. */
export function navLocationOfLoc(loc: PaneLoc): NavLocation {
  if (loc.kind === 'msession') return { kind: 'session', sessionId: loc.id, title: loc.title ?? '' }
  return { kind: 'section', section: loc.id, ...locOfSeed(loc.seed ?? {}) }
}

/** ── Browser Back/Forward, per page (the popstate planner) ──────────────────
 *  What to do with the CANONICAL path the history moved to. Order matters:
 *  the focused pane's own back top first (the address is where an in-page
 *  door came from — pop it, so the deeper chain survives), then any pane
 *  already showing the address (a focus hop's entry — refocus, never mint a
 *  duplicate over the focused pane), then a plain route (a fresh landing in
 *  the focused pane, like every navigation). */
export type PopPlan =
  | { kind: 'pop'; path: string; content: MainPaneContent }
  | { kind: 'focus'; path: string }
  | { kind: 'route' }

export function planPop(tree: MainSplitNode | null, focusedPane: string, targetPath: string): PopPlan {
  const all = panes(tree)
  const focused = all.find((p) => p.path === focusedPane)
  const c = focused?.content
  if (c && c.kind !== 'context-panel') {
    // The page BEHIND the live one, from the same FOLDED chain a door would
    // push (carried stack + the in-section stack + live) — so browser Back
    // over an in-section hop pops too, with the carried stack surviving into
    // the restored page's `back` (a plain route here would amputate it).
    const chain = pushedBack(c)
    const prev = chain.length >= 2 ? chain[chain.length - 2] : undefined
    if (prev && paneLocationPath(contentForLoc(prev, [])) === targetPath) {
      return { kind: 'pop', path: focused.path, content: contentForLoc(prev, chain.slice(0, chain.length - 2)) }
    }
  }
  const showing = all.find((p) => paneLocationPath(p.content) === targetPath)
  if (showing) return { kind: 'focus', path: showing.path }
  return { kind: 'route' }
}

/** Scrub back stacks against a keep predicate (the live-prune companion: a
 *  deleted session must vanish from every pane's HISTORY too, or the back
 *  affordance would walk into a dead thread). Entries are judged as the
 *  content they'd restore to; reference-preserving when nothing changes. */
export function scrubBackStacks(
  tree: MainSplitNode | null,
  keep: (c: MainPaneContent) => boolean,
): MainSplitNode | null {
  if (!tree) return tree
  const walk = (n: SplitNode<MainPaneContent>): SplitNode<MainPaneContent> => {
    if (n.kind === 'pane') {
      const c = n.content
      if (c.kind === 'context-panel' || !c.back?.length) return n
      // Filter the dead entries, then re-collapse the neighbors the removal
      // may have made adjacent-identical (pushedBack's dedup invariant —
      // without it, back would need two clicks through one page).
      const kept: PaneLoc[] = []
      for (const loc of c.back) {
        if (!keep(contentForLoc(loc, []))) continue
        if (!kept.length || !samePaneLoc(kept[kept.length - 1], loc)) kept.push(loc)
      }
      if (kept.length === c.back.length) return n
      return { ...n, content: { ...c, back: kept.length ? kept : undefined } }
    }
    const a = walk(n.a)
    const b = walk(n.b)
    return a === n.a && b === n.b ? n : { ...n, a, b }
  }
  return walk(tree)
}
