/** ── Foldable list-section headers ───────────────────────────────────────────
 *  The disclosure headers that collapse / expand a group of rows *in place* — the
 *  Artifacts / Contexts / Scheduled section headers and a workspace panel's folder
 *  headers. The hover cue that tells a user "this header is click-able" is the same
 *  surface-lift the left rail uses (SIDEBAR_HOVER), so the whole app shares one
 *  hover: change it once and every fold header — and every sidebar control —
 *  follows, instead of the cue drifting between copies.
 *
 *  (On the page canvas this lift is subtler than in the sidebar — the canvas is
 *  already near-white, so a 70%-white hover has less to contrast against than it
 *  does over the darker sidebar. That's inherent to using one surface tint on two
 *  backgrounds; it's the trade for a single, consistent hover language.)
 *
 *  Plain strings (no JSX) so the DOM-less Node test runner can import and assert
 *  them — see tests/foldHeader.test.ts. */
import { SIDEBAR_HOVER } from './sidebar.ts'

/** The fold-header hover, per surface. Both adopt the shared left-panel hover, so
 *  the cue is identical across the app; the two keys stay so each call site reads
 *  which surface it's on. (`transition` pairs the background change with an
 *  animation — every fold header is otherwise un-transitioned.) */
export const FOLD_HOVER = {
  /** The page canvas — the Artifacts / Contexts / Scheduled section group headers. */
  page: `transition ${SIDEBAR_HOVER}`,
  /** Inside a workspace panel — the artifact folder group headers. */
  panel: `transition ${SIDEBAR_HOVER}`,
}

/** The full class for a page-level section group header: content-width and
 *  left-aligned with the list below (the negative margin cancels the left padding,
 *  so the hover highlight gets breathing room with no resting-state layout shift),
 *  carrying the shared hover. */
export const FOLD_HEADER_CLASS =
  `group mb-1.5 -ml-1.5 flex w-fit items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2.5 text-left ${FOLD_HOVER.page}`
