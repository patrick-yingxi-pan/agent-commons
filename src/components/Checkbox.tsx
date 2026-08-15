import { Check } from 'lucide-react'
import {
  CHECKBOX_BOX_CLASS,
  CHECKBOX_BOX_OFF_CLASS,
  CHECKBOX_BOX_ON_CLASS,
  DEFAULT_BADGE_CLASS,
  DEFAULT_TOGGLE_CLASS,
} from '../lib/checkbox'

/** The one checkbox square (cue in src/lib/checkbox.ts) — every checkbox in the app
 *  wears this accent-filled square, never a raw `<input type="checkbox">` (form
 *  follows function; src/lib/checkbox.test.ts fails on either escape). Presentational:
 *  the interactive wrapper (a `role="checkbox"` button) supplies the behavior. */
export function CheckSquare({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span className={`${className ? `${className} ` : ''}${CHECKBOX_BOX_CLASS} ${checked ? CHECKBOX_BOX_ON_CLASS : CHECKBOX_BOX_OFF_CLASS}`}>
      {checked && <Check size={10} strokeWidth={3} />}
    </span>
  )
}

/** A labeled checkbox row — the square plus its clickable label, the standard form
 *  for a boolean choice (the relay panel's "I've saved the secret", a commission's
 *  Standing grant, an admitted-connector checklist row). */
export function CheckboxRow({
  checked,
  onToggle,
  children,
  className,
}: {
  checked: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={`flex items-start gap-2 text-left ${className ?? ''}`}
    >
      <CheckSquare checked={checked} className="mt-0.5" />
      {children}
    </button>
  )
}

/** The one "set as default" control a registry create/edit dialog offers (Model
 *  providers, system prompts) — form follows function: both dialogs wear this exact
 *  row, and src/lib/checkbox.test.ts fails if one re-hardcodes its own checkbox.
 *
 *  The flag it toggles is a **UI shortcut only**: the flagged entry is what the
 *  New-agent pickers pre-select — the API never resolves an absent binding to it,
 *  and clearing it (or having no default at all) is a perfectly valid state (the
 *  pickers then pre-select the first entry). So this is a plain, freely-uncheckable
 *  checkbox — no radio semantics, no protected state. */
export function DefaultToggle({
  checked,
  onChange,
  entity,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** What the flag marks — 'provider' | 'prompt' (reads "Default provider"). */
  entity: string
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className={DEFAULT_TOGGLE_CLASS}>
      <CheckSquare checked={checked} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="text-[12px] font-medium text-ink">Default {entity}</span>
        <span className="text-[11px] leading-snug text-ink-faint">
          Pre-selected when you create an agent. A convenience only — agents always name their {entity} explicitly.
        </span>
      </span>
    </button>
  )
}

/** The registry chip marking the flagged default entry — one look everywhere
 *  (provider pages, prompt cards), sourced from the same lib literal as the toggle. */
export function DefaultBadge() {
  return <span className={DEFAULT_BADGE_CLASS}>Default</span>
}
