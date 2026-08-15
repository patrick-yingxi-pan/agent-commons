/** ── A page section's fold posture ──────────────────────────────────────────
 *  Owner directive, 2026-08-12: the entity page is *"two columns and a lot of
 *  frames"*; make it **one column of foldable sections**, reusing the fold work
 *  rather than inventing a second kind of it — *"one solution for many similar
 *  problems with adapted UI styles"*.
 *
 *  **What is reused, and what deliberately is not.** The disclosure CUE is
 *  shared (`lib/foldHeader.ts`, now worn by every main-page `FoldSection`), and
 *  so is the two-independent-buttons rule for
 *  Fold all · Unfold all (SOCIAL-21 — they are not inverses, so they are never
 *  one toggle). What is NOT reused is `lib/replyTree.ts`: a discussion is a
 *  recursive tree with invertible per-node state, branch counts, a caret centred
 *  on the hairline its branch hangs from, and a discard for flattening. A page's
 *  sections are a FLAT NAMED LIST. Same rule ("same role ⇒ same look"), applied
 *  honestly: the roles differ below the cue, so only the cue is shared.
 *
 *  What IS carried over from the thread is the **stub**: a folded post is an
 *  index entry — who, when, the opening words, how much is hidden — never a
 *  gap. A folded section owes the same, hence `summary` on `<FoldSection>`.
 *  "Sharing · tenant-beta, published" is worth folding to; a bare chevron is
 *  not, and a page of bare chevrons is an index of nothing.
 *
 *  ── Why stable sections persist where dynamic collection bands do not ──────
 *
 *  That module states the rule and the reason it did not qualify: an entity
 *  disclosure is *navigation memory*, and its key space is unbounded — one entry
 *  per item ever opened — *"exactly what the small per-account `uiPrefs` blob
 *  must not become"*. Both halves invert for a schema section. Its fold is a PREFERENCE
 *  ("I never look at Sharing"), not a reading position, so it should outlive the
 *  tab the way the rail's own pane folds do; and the key space is the set of
 *  section TITLES, which is closed, small (~20) and grows only when someone
 *  writes a new section. Collection roots now reuse the SAME FoldSection frame,
 *  but a band named by live data (for example a user-created Project grouping
 *  artifacts) passes `persist={false}` and keeps its posture locally. One look
 *  does not require one dishonest storage lifetime.
 *
 *  **Keyed by title, so the same-named section shares one posture across pages.**
 *  Deliberate, and the reason the space stays bounded: the preference is about a
 *  kind of content, not about one project. Fold Sharing away on one project and
 *  you have said you do not want to look at sharing configuration — a per-entity
 *  key would make you say it once per project, and would grow the blob without
 *  bound, which is the thing `disclosure.ts` refused for.
 *
 *  DOM-free and React-free (the `sectionFilter.ts` split), so `node --test`
 *  exercises the semantics; the wiring is `useSectionFold.ts`. */
import { getLayout, setLayout } from './uiPrefs.ts'

/** The stored key for one section title.
 *
 *  Slugged rather than used raw: the blob is JSON and a title is human copy that
 *  may carry spaces, punctuation or a case change, none of which should mint a
 *  second key for the same section. Case-folded for the same reason — "Open
 *  work" and "OPEN WORK" are one section rendered by two callers' capitalisation
 *  (the header uppercases in CSS, so the source string is whatever the author
 *  typed). */
export function sectionFoldKey(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `fold.section.${slug}`
}

/** Is this section folded right now?
 *
 *  `defaultFolded` is the CALLER's declaration of what the section is for, not a
 *  stored value — configuration opens folded (owner decision 2026-08-12: config
 *  folded, content open), content opens open. Stored state overrides it in both
 *  directions, so unfolding Sharing once keeps it unfolded, and folding
 *  Discussion once keeps it folded. */
export function isSectionFolded(title: string, defaultFolded = false): boolean {
  return getLayout(sectionFoldKey(title), defaultFolded)
}

/** Write one section's posture. Never call during render — `setLayout` notifies
 *  synchronously (invariant UI-21); this belongs in the click handler. */
export function setSectionFolded(title: string, folded: boolean): void {
  setLayout(sectionFoldKey(title), folded)
}

/** What a page-level Fold all / Unfold all has left to do, over the sections a
 *  page declares.
 *
 *  The same asymmetry SOCIAL-21 settled for the thread, and it is settled here
 *  for the same reason rather than by analogy: the two acts are not inverses of
 *  each other, so a single `allFolded` toggle makes the way out vanish exactly
 *  when it is needed — fold everything, open one section to read it, and the
 *  control that would put it back has relabelled itself. Each renders only when
 *  it has work, so the pair is never two equally-lit controls where one is
 *  inert.
 *
 *  Simpler than the thread's, and legitimately so: sections do not nest, so
 *  "fold all" has no interior to preserve and the two acts really are total over
 *  one flat set. That is the difference the shared-machinery instinct would have
 *  hidden. */
export function pageFoldWork(
  titles: readonly string[],
  isFolded: (title: string) => boolean,
): { foldable: string[]; unfoldable: string[] } {
  const foldable: string[] = []
  const unfoldable: string[] = []
  for (const t of titles) (isFolded(t) ? unfoldable : foldable).push(t)
  return { foldable, unfoldable }
}
