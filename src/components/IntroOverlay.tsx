import { motion } from 'framer-motion'
import { ArrowRight, GitBranch, MessagesSquare, PanelsTopLeft, X } from 'lucide-react'
import { ClaudeMark } from './ClaudeMark'

export function IntroOverlay({
  onClose,
  onStartTour,
}: {
  onClose: () => void
  onStartTour: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <X size={17} />
        </button>

        <div className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <ClaudeMark />
            <span className="font-serif text-lg font-semibold text-ink">
              One surface for Chat, Cowork &amp; Code
            </span>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Today the desktop app splits work across three top-level tabs. But Chat, Cowork, and Code
            are the same primitive — a conversation with Claude plus some context — wearing three
            different costumes. The split has a cost:
          </p>

          <ul className="mt-3 space-y-2 text-sm text-ink">
            <Problem>
              You pick a <b>mode up front</b>, before you know where the work will actually go.
            </Problem>
            <Problem>
              Each tab is a <b>silo</b> — separate history, separate composer. A chat can’t become a
              coding task without starting over and re-explaining context.
            </Problem>
            <Problem>
              The capabilities <b>overlap heavily</b>, so three tabs read as redundant rather than
              distinct.
            </Problem>
          </ul>

          <div className="mt-4 rounded-xl border border-line bg-panel p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
              The proposal
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink">
              Collapse the three tabs into <b>one conversation with an adaptive workspace</b>. You
              just start talking; context (a folder, a repo, a connector) <i>attaches</i> to the
              thread, and the panel on the right progressively reveals the right tools.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium">
              <Stage icon={<MessagesSquare size={15} />} label="Chat" />
              <ArrowRight size={15} className="text-ink-faint" />
              <Stage icon={<PanelsTopLeft size={15} />} label="Workspace" />
              <ArrowRight size={15} className="text-ink-faint" />
              <Stage icon={<GitBranch size={15} />} label="Repo" />
              <span className="ml-1 text-xs text-ink-faint">· one thread</span>
            </div>
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

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="leading-relaxed">{children}</span>
    </li>
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
