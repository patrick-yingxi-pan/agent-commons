/** Viewport tiers for the responsive layout ladder (FWD-3 / PD35). The right panel
 *  sits side-by-side with the thread on a wide window, but on smaller ones it would
 *  crush the conversation column — so below `wide` it overlays as a drawer instead,
 *  and on a phone both side surfaces go off-canvas entirely.
 *
 *    wide   (≥1024) — left rail + thread + right panel side-by-side (desktop layout)
 *    medium (≥640)  — right panel overlays the thread behind a scrim (tablet)
 *    narrow (<640)  — left rail becomes an off-canvas drawer + scrim; the right
 *                     panel takes over the full viewport (phone). This supersedes
 *                     the earlier icon-rail idea: a 48–56px rail would eat ~14% of
 *                     a 375px screen for near-zero value (see PD35).
 *
 *  A second, independent axis handles HEIGHT: `short` (<480px tall — a landscape
 *  phone) compresses the fixed chrome (proposal band, caption bar, composer). It is
 *  exposed both here (for JS decisions) and as the Tailwind `short:` custom variant
 *  in src/index.css — the two literals are locked together by tests/viewport.test.ts.
 *
 *  The width helpers are pure (unit-tested); `useViewport` wires them to the window.
 *  Persisted rail/panel widths are clamped at RENDER time by these helpers — never
 *  rewritten in storage — so a phone visit can't clobber the desktop layout. */
import { useEffect, useState } from 'react'

export type ViewportTier = 'wide' | 'medium' | 'narrow'

export const WIDE_MIN = 1024
export const MEDIUM_MIN = 640
export const SHORT_MAX = 480

/** Right panel geometry — one source of truth (PanelShell renders with this). */
export const PANEL_MIN = 300
export const PANEL_MAX = 640
/** Room the conversation column keeps beside a side-by-side / overlay panel. */
export const PANEL_GUTTER = 360
/** Sliver of scrim kept tappable beside the narrow-tier rail drawer. */
export const RAIL_SCRIM_SLIVER = 56

export function tierFor(width: number): ViewportTier {
  if (width >= WIDE_MIN) return 'wide'
  if (width >= MEDIUM_MIN) return 'medium'
  return 'narrow'
}

export function isShort(height: number): boolean {
  return height < SHORT_MAX
}

/** ── Split-direction room — each direction gates on ITS OWN axis ────────────
 *  Splitting duplicates the focused pane along one axis, so the offer follows
 *  the axis it would consume: side-by-side (row) needs WIDTH — the wide tier,
 *  whose 1024px floor is exactly two ~512px columns (tiling only exists there;
 *  the overlay tiers render one pane at a time) — and stacking (col) needs
 *  HEIGHT on top of that: two bands of at least ~300px each (a title bar plus
 *  usable content — the right panel's PANEL_MIN applies the same floor to a
 *  pane's other axis). Close rides the pair: it is offered iff either split
 *  is (the cluster appears and disappears as one). */
export const SPLIT_COL_MIN_H = 600

export function canSplitRow(tier: ViewportTier): boolean {
  return tier === 'wide'
}

export function canSplitCol(tier: ViewportTier, height: number): boolean {
  return tier === 'wide' && height >= SPLIT_COL_MIN_H
}

/** The width the right panel actually renders at: full takeover on narrow;
 *  otherwise the user's preferred width clamped so the thread keeps its gutter. */
export function panelWidthFor(tier: ViewportTier, vw: number, preferred: number): number {
  if (tier === 'narrow') return vw
  const ceiling = Math.min(PANEL_MAX, Math.max(PANEL_MIN, vw - PANEL_GUTTER))
  return Math.min(Math.max(preferred, PANEL_MIN), ceiling)
}

/** The CSS width the left rail renders at: on narrow it is an off-canvas drawer
 *  capped so a sliver of scrim stays tappable — expressed as a CSS `min()` so the
 *  clamp tracks the live viewport without a resize listener. Elsewhere, the
 *  preference verbatim. */
export function railWidthCss(tier: ViewportTier, preferred: number): string {
  if (tier === 'narrow') return `min(${preferred}px, calc(100vw - ${RAIL_SCRIM_SLIVER}px))`
  return `${preferred}px`
}

export type Viewport = { tier: ViewportTier; short: boolean; stackable: boolean }

const measure = (): Viewport => {
  const tier = tierFor(window.innerWidth)
  return {
    tier,
    short: isShort(window.innerHeight),
    stackable: canSplitCol(tier, window.innerHeight),
  }
}

/** The current viewport tier + the two height-axis flags (`short` chrome
 *  compression, `stackable` split-down room), updated on resize. SSR-safe
 *  (assumes a wide, tall window when there's no window). */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined' ? { tier: 'wide', short: false, stackable: true } : measure(),
  )
  useEffect(() => {
    const onResize = () =>
      setViewport((v) => {
        const next = measure()
        return next.tier === v.tier && next.short === v.short && next.stackable === v.stackable
          ? v
          : next
      })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return viewport
}
