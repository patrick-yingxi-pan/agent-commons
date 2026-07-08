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
}: {
  /** The exact string written to the clipboard. */
  text: string
  /** Idle label (e.g. "Copy", "Copy JSON"). */
  label?: string
  /** Momentary confirmation label after a click. */
  copiedLabel?: string
  /** Accessible name when the visible label alone isn't specific enough. */
  ariaLabel?: string
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
      }}
      aria-label={ariaLabel ?? label}
      className={COPY_BUTTON_CLASS}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
