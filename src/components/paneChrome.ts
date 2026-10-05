/** ── Pane chrome context (universal split Phase 4) ───────────────────────────
 *  How a context panel renders EDGE TO EDGE inside a universal-tree pane without
 *  touching the panel bodies: every context panel (workspace/repo, connector,
 *  attachments) renders through the ONE PanelShell, so ContextPanelView
 *  provides this context and PanelShell adapts — `embedded` drops the shell's own
 *  width / slide animation (the pane's split node owns geometry) AND its own
 *  close X (the rail cluster closes the focused pane, homogeneous with every
 *  other pane). Default `{}` = the legacy docked / takeover shell (the overlay
 *  tiers, ADAPT-11), byte-identical to before context panels folded into the tree.
 *
 *  (The old split-frame's `onSplit` / `onClosePane` chrome was retired with the
 *  ADAPT-16 right frame — the universal split's rail cluster owns split + close.) */
import { createContext, type ReactNode } from 'react'

export interface PaneChrome {
  /** Rendered inside a universal-tree pane: fill the parent, no own width /
   *  motion, and no per-pane close X (the rail cluster closes it). */
  embedded?: boolean
  /** Panel-scoped status/recovery UI, rendered below the scrollable body. */
  footer?: ReactNode
}

export const PaneChromeContext = createContext<PaneChrome>({})
