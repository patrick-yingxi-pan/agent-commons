import { useEffect, useState } from 'react'
import { COPY_BUTTON_CLASS } from '../lib/copyButton'

/** The one copy-to-clipboard button. Every "Copy" affordance wears this so the cue
 *  (the compact bordered pill, the label swapping to "Copied" on click, and the
 *  self-resetting confirmation) can't drift between copy-pasted copies — form
 *  follows function, one styled primitive (tests/copy-button.test.ts fails if a
 *  component re-hardcodes the markup). It owns its own transient confirmation
 *  state, so callers just hand it the text to copy. */

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  ariaLabel,
  onCopied,
}: {
  /** The exact string written to the clipboard. */
  text: string
  /** Idle label (e.g. "Copy", "Copy JSON"). */
  label?: string
  /** Momentary confirmation label after a click. */
  copiedLabel?: string
  /** Accessible name when the visible label alone isn't specific enough. */
  ariaLabel?: string
  /** Fired when the user actually takes the text. The button's own "Copied" flash
   *  self-resets (it's a confirmation, not a state), so a caller that needs to KNOW
   *  the copy happened — e.g. a one-time-secret reveal whose close-gate is satisfied
   *  by taking the credential rather than by ticking a box promising you did — must
   *  be told. Observation, not attestation. */
  onCopied?: () => void
}) {
  const [copied, setCopied] = useState(false)
  // Self-reset so the button doesn't sit on a stale "Copied" — the modern default.
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        onCopied?.()
      }}
      aria-label={ariaLabel ?? label}
      className={COPY_BUTTON_CLASS}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
