/** One shared primitive for every photo surface (the picker grid, the Browse grid,
 *  the attachment panel's strip + hero): render a real image when we have a URL,
 *  fall back to a deterministic gradient when we don't (loading, no source, or a
 *  client-side pick that hasn't produced an object URL). Form follows function — a
 *  photo looks the same everywhere because one component draws it. Children are
 *  overlaid (a ✓ "Added" badge, a caption), so callers compose without re-styling. */
import { useState, type ReactNode } from 'react'
import { gradientFor } from '../lib/thumbs'

export function PhotoThumb({
  id,
  src,
  className = '',
  title,
  onClick,
  children,
}: {
  /** Stable id for the gradient fallback (so the same photo keeps its hue). */
  id: string
  /** Image URL (served bytes or a client object URL); absent → gradient fallback. */
  src?: string
  /** Sizing / rounding / ring classes for the box. */
  className?: string
  title?: string
  /** When set, renders as a button (the interactive picker/strip cells). */
  onClick?: () => void
  children?: ReactNode
}) {
  // Fall back to the gradient if the image fails to load — a served source going
  // offline / a deleted file 404s, and a broken-image icon would be worse than the
  // gradient. Tracks the failed URL so a new `src` retries.
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined)
  const showImg = !!src && src !== failedSrc
  const cls = `relative overflow-hidden ${showImg ? '' : gradientFor(id)} ${className}`
  const inner = (
    <>
      {showImg && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {children}
    </>
  )
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cls}>
      {inner}
    </button>
  ) : (
    <div title={title} className={cls}>
      {inner}
    </div>
  )
}
