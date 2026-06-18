import { CAP_META, CAP_ORDER } from '../lib/capabilities'
import type { Capability } from '../types'

/** The small capability badges that replace the old top-level tabs. A
 *  conversation can carry one, two, or all three at once. */
export function CapBadges({
  caps,
  size = 'sm',
}: {
  caps: Capability[]
  size?: 'sm' | 'md'
}) {
  const ordered = CAP_ORDER.filter((c) => caps.includes(c))
  const px = size === 'md' ? 'h-6 px-2 text-xs gap-1.5' : 'h-5 px-1.5 text-[11px] gap-1'
  const iconSize = size === 'md' ? 13 : 11
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered.map((cap) => {
        const { Icon, label, color, tint } = CAP_META[cap]
        return (
          <span
            key={cap}
            className={`inline-flex items-center rounded-full ${tint} ${color} ${px} font-medium`}
            title={`${label} — was the “${CAP_META[cap].legacyTab}” tab`}
          >
            <Icon size={iconSize} strokeWidth={2.25} />
            {size === 'md' && <span>{label}</span>}
          </span>
        )
      })}
    </div>
  )
}
