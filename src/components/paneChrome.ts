/** ── Pane chrome context (spec ADAPT-16) ─────────────────────────────────────
 *  How the split frame re-dresses the existing panels without touching them:
 *  every context panel (workspace/repo, connector, attachments, runs) renders
 *  through the ONE PanelShell, so the frame provides this context and PanelShell
 *  adapts — `embedded` drops the shell's own width/motion (the pane's split node
 *  owns geometry), `onClosePane` retargets the shell's X at the pane, and
 *  `onSplit` (also provided OUTSIDE the frame, on the wide tier's single docked
 *  panel) puts the split-right / split-down buttons in the header. Default `{}`
 *  = the legacy docked shell, byte-identical to before the frame existed. */
import { createContext } from 'react'
import type { SplitDir } from '../lib/splitFrame'

export interface PaneChrome {
  /** Rendered inside a split-frame pane: fill the parent, no own width/motion. */
  embedded?: boolean
  /** Offer split-right / split-down header buttons (wide tier only — the caller
   *  gates; the overlay tiers have no room to tile). */
  onSplit?: (dir: SplitDir) => void
  /** Override the shell's close button (close THIS pane, not the whole panel). */
  onClosePane?: () => void
}

export const PaneChromeContext = createContext<PaneChrome>({})
