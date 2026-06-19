import { Info, Lightbulb } from 'lucide-react'

/** The proposal's own framing — deliberately *outside* the product mock below
 *  it. It carries the concept label and the "About this proposal" explanation,
 *  so the product chrome can read like a real app rather than a pitch. The
 *  guided-tour strip renders right under this, sharing the same dark band. */
export function ProposalBar({ onAbout }: { onAbout: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 px-4">
      <span className="flex min-w-0 items-center gap-2">
        <Lightbulb size={15} className="shrink-0 text-accent" />
        <span className="font-serif text-[14px] font-semibold tracking-tight text-canvas">
          Unified Workspace
        </span>
        <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-canvas/70 sm:inline">
          a Claude UI concept
        </span>
      </span>
      <button
        onClick={onAbout}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-canvas/80 transition hover:bg-white/10 hover:text-canvas"
      >
        <Info size={15} />
        About this proposal
      </button>
    </div>
  )
}
