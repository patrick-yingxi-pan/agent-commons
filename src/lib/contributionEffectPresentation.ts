/** Shared presentation seams for the narrow, pane-local Contribution form. */
export const CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS = 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))'

export const CONTRIBUTION_EFFECT_DISCLOSURE_CLASS = 'text-[11px] leading-relaxed text-ink-soft'

export const CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS = 'text-[12px] font-semibold text-ink'

/** Shared AA-safe seats for the envelope's semantic status chips. The warning
 * foreground is calibrated against warn-tint; a faint strong-color wash is not
 * an interchangeable background because it changes the contrast pair. */
export const CONTRIBUTION_ENVELOPE_STATUS_CLASSES = {
  proposed: 'inline-flex items-center gap-1 rounded-full bg-warn-tint px-2 py-0.5 text-[11px] font-medium text-warn-text',
  approved: 'inline-flex items-center gap-1 rounded-full bg-ok-tint px-2 py-0.5 text-[11px] font-medium text-ok-text',
} as const

export const CONTRIBUTION_LOCAL_STDIO_DISCLOSURE = 'Local MCP process. The selected program runs with normal access to the connection owner’s computer and may have effects just by starting; this is not a sandbox. Each run uses only the reviewed tool and arguments. Arguments and saved results are visible to every Project reader; launch settings stay private.'
