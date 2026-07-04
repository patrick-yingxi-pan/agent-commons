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

export type Viewport = { tier: ViewportTier; short: boolean }

/** The current viewport tier + short-height flag, updated on resize. SSR-safe
 *  (assumes a wide, tall window when there's no window). */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined'
      ? { tier: 'wide', short: false }
      : { tier: tierFor(window.innerWidth), short: isShort(window.innerHeight) },
  )
  useEffect(() => {
    const onResize = () =>
      setViewport((v) => {
        const next = { tier: tierFor(window.innerWidth), short: isShort(window.innerHeight) }
        return next.tier === v.tier && next.short === v.short ? v : next
      })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return viewport
}
