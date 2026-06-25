import { useRef } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  GitBranch,
  LayoutGrid,
  Layers,
  MessagesSquare,
  MonitorSmartphone,
  PanelsTopLeft,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react'
import { ClaudeMark } from './ClaudeMark'
import { useFocusTrap } from '../lib/useFocusTrap'

export function IntroOverlay({
  onClose,
  onStartTour,
}: {
  onClose: () => void
  onStartTour: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const tourBtnRef = useRef<HTMLButtonElement>(null)

  // Modal a11y: focus the primary action on open, trap Tab within the dialog,
  // close on Escape, and restore focus to whatever opened it on close.
  useFocusTrap(dialogRef, onClose, { initialFocus: tourBtnRef })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <X size={17} />
        </button>

        <div className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <ClaudeMark />
            <span id="intro-title" className="font-serif text-lg font-semibold text-ink">
              One surface for Chat, Cowork &amp; Code
            </span>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
            Today the desktop app splits work across three tabs — Chat, Cowork, and Code. They’re one
            primitive — a conversation plus some context — in three costumes. Here’s what changes when
            they collapse into a single adaptive thread:
          </p>

          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
            <Win icon={<Layers size={15} />} title="One surface, not three tabs">
              Chat, Cowork &amp; Code become a single conversation.
            </Win>
            <Win icon={<Sparkles size={15} />} title="No mode up front">
              Just start typing; the workspace appears as the work needs it.
            </Win>
            <Win icon={<Workflow size={15} />} title="Context travels the thread">
              Escalate from chat to files to a repo without re-explaining.
            </Win>
            <Win icon={<Plus size={15} />} title="One “Add context”">
              Files, folders, repos, connectors &amp; MCP through a single door.
            </Win>
            <Win icon={<Search size={15} />} title="One history, one search">
              Every conversation is one row that carries its own tools.
            </Win>
            <Win icon={<LayoutGrid size={15} />} title="Tools, not tabs">
              Projects, Artifacts &amp; Scheduled live as utilities, not modes.
            </Win>
            <Win icon={<ShieldCheck size={15} />} title="Claude proposes, you confirm">
              Filing, saving &amp; scheduling arrive as inline cards to approve.
            </Win>
            <Win icon={<MonitorSmartphone size={15} />} title="One contract, no drift">
              The same UI runs on desktop and web, so they can’t diverge.
            </Win>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-line bg-panel py-2.5 text-sm font-medium">
            <Stage icon={<MessagesSquare size={15} />} label="Chat" />
            <ArrowRight size={15} className="text-ink-faint" />
            <Stage icon={<PanelsTopLeft size={15} />} label="Workspace" />
            <ArrowRight size={15} className="text-ink-faint" />
            <Stage icon={<GitBranch size={15} />} label="Repo" />
            <span className="ml-1 text-xs text-ink-faint">· one thread</span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-line bg-panel px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-panel-2 hover:text-ink"
          >
            Explore on my own
          </button>
          <button
            ref={tourBtnRef}
            onClick={onStartTour}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-strong"
          >
            Play the guided tour
            <ArrowRight size={15} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Win({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-tint text-accent-strong">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-snug text-ink">{title}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">{children}</p>
      </div>
    </div>
  )
}

function Stage({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-ink">
      {icon}
      {label}
    </span>
  )
}
