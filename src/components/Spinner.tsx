import { Loader2 } from 'lucide-react'
import { SPINNER_CLASS } from '../lib/spinner'

/** The one loading spinner. Wraps lucide's Loader2 with the shared motion-safe
 *  spin so every "in progress" indicator animates identically AND honors
 *  `prefers-reduced-motion` (a static icon for motion-sensitive viewers) — form
 *  follows function, one styled primitive (tests/spinner.test.ts fails if a
 *  component re-hardcodes bare `animate-spin`). Per-site extras — size, colour
 *  (`text-accent`), margin (`mt-0.5 shrink-0`) — ride `size` / `className`. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} aria-hidden className={className ? `${SPINNER_CLASS} ${className}` : SPINNER_CLASS} />
}
