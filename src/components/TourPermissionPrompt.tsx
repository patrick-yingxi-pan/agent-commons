import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Folder, FolderOpen, FolderPlus, Github, ShieldAlert } from 'lucide-react'

/** ── The guided tour's consent gate ───────────────────────────────────────────
 *  Before the tour escalates a chat into a workspace — or connects a repo /
 *  GitHub — it asks first, mirroring the desktop app's "Claude would like to
 *  Cowork in a folder → Deny / Choose folder" prompt. It renders inline under
 *  Claude's reply (aligned to the message body) and is the gate: the escalation
 *  applies only when the user approves.
 *
 *  • Workspace: the user must *pick a root folder* — `Choose folder` reveals the
 *    candidate roots (the browser mock's stand-in for the native picker), and the
 *    one chosen becomes the workspace's root.
 *  • Repo: a single `Connect` approves attaching the repo + its connector.
 *  • Project: a single `Create project` files this session into a new project.
 *
 *  Deny doesn't dead-end the tour: it flips the card to a recoverable "access
 *  denied" view with `Grant access`, and the tour stays paused (the caption bar's
 *  "Next" is disabled) until access is granted. */
export function TourPermissionPrompt({
  kind,
  rootChoices = [],
  connectorLabel = 'GitHub',
  projectName = 'New project',
  onApprove,
}: {
  kind: 'workspace' | 'repo' | 'project'
  rootChoices?: readonly string[]
  connectorLabel?: string
  projectName?: string
  onApprove: (workspaceRoot?: string) => void
}) {
  const [denied, setDenied] = useState(false)
  // Workspace only: whether the folder picker (the candidate-root list) is open.
  const [picking, setPicking] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const firstChoiceRef = useRef<HTMLButtonElement>(null)

  // Focus the primary action on mount / when returning from the denied view, and
  // the first folder when the picker opens — so Enter activates the obvious next
  // step and Esc (handled below) reads as Deny, matching the desktop prompt.
  useEffect(() => {
    if (denied) return
    if (picking) firstChoiceRef.current?.focus()
    else primaryRef.current?.focus()
  }, [denied, picking])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !denied) {
      e.stopPropagation()
      if (picking) setPicking(false)
      else setDenied(true)
    }
  }

  return (
    <div className="px-4 pb-3">
      <div className="mx-auto flex w-full max-w-3xl gap-3">
        {/* Avatar-width spacer so the card aligns under Claude's message body. */}
        <div className="w-7 shrink-0" aria-hidden />
        <motion.div
          ref={rootRef}
          role="dialog"
          aria-label={
            kind === 'workspace'
              ? 'Cowork in a folder'
              : kind === 'project'
                ? `Create ${projectName} project`
                : `Connect ${connectorLabel}`
          }
          onKeyDown={onKeyDown}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="min-w-0 flex-1 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-sm"
        >
          {denied ? (
            <DeniedView
              kind={kind}
              connectorLabel={connectorLabel}
              projectName={projectName}
              onRetry={() => setDenied(false)}
            />
          ) : kind === 'project' ? (
            <Prompt
              icon={<FolderPlus size={16} />}
              title={
                <>
                  Claude would like to create the{' '}
                  <b className="font-semibold text-ink">{projectName}</b> project
                </>
              }
              subtitle="Creates a new project and files this session into it, so its chats, docs, and code live in one place. Nothing else moves."
              primaryLabel="Create project"
              primaryRef={primaryRef}
              onDeny={() => setDenied(true)}
              onPrimary={() => onApprove()}
            />
          ) : kind === 'workspace' ? (
            picking ? (
              <FolderPicker
                rootChoices={rootChoices}
                firstChoiceRef={firstChoiceRef}
                onPick={(path) => onApprove(path)}
                onCancel={() => setPicking(false)}
              />
            ) : (
              <Prompt
                icon={<Folder size={16} />}
                title={
                  <>
                    Claude would like to <b className="font-semibold text-ink">Cowork</b> in a folder
                  </>
                }
                subtitle="Pick a root folder to work in. Claude reads and writes inside it — nothing outside is touched."
                primaryLabel="Choose folder"
                primaryRef={primaryRef}
                onDeny={() => setDenied(true)}
                onPrimary={() => setPicking(true)}
              />
            )
          ) : (
            <Prompt
              icon={<Github size={16} />}
              title={
                <>
                  Claude would like to connect{' '}
                  <b className="font-semibold text-ink">{connectorLabel}</b>
                </>
              }
              subtitle="Connects the GitHub connector and your repository to this session, so Claude can branch, diff, and run."
              primaryLabel="Connect"
              primaryRef={primaryRef}
              onDeny={() => setDenied(true)}
              onPrimary={() => onApprove()}
            />
          )}
        </motion.div>
      </div>
    </div>
  )
}

/** The default ask: an icon, a one-line request, a subtitle, and the Deny /
 *  primary action pair (with the desktop prompt's Esc / Enter key hints). */
function Prompt({
  icon,
  title,
  subtitle,
  primaryLabel,
  primaryRef,
  onDeny,
  onPrimary,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle: string
  primaryLabel: string
  primaryRef: React.RefObject<HTMLButtonElement | null>
  onDeny: () => void
  onPrimary: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-strong">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-snug text-ink-soft">{title}</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">{subtitle}</p>
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            onClick={onDeny}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition hover:bg-panel-2 hover:text-ink"
          >
            Deny
            <Key>Esc</Key>
          </button>
          <button
            ref={primaryRef}
            onClick={onPrimary}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-strong"
          >
            {primaryLabel}
            <Key tone="onAccent">Enter</Key>
          </button>
        </div>
      </div>
    </div>
  )
}

/** The browser mock's stand-in for the native folder dialog: the candidate roots
 *  as a pick list. The first is the suggestion; clicking any row selects it as
 *  the cowork root and approves. */
function FolderPicker({
  rootChoices,
  firstChoiceRef,
  onPick,
  onCancel,
}: {
  rootChoices: readonly string[]
  firstChoiceRef: React.RefObject<HTMLButtonElement | null>
  onPick: (path: string) => void
  onCancel: () => void
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <FolderOpen size={15} className="text-accent-strong" />
        Choose a folder to Cowork in
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {rootChoices.map((path, i) => (
          <button
            key={path}
            ref={i === 0 ? firstChoiceRef : undefined}
            onClick={() => onPick(path)}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2 focus:bg-panel-2 focus:outline-none"
          >
            <Folder size={15} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{path}</span>
            {i === 0 && (
              <span className="shrink-0 rounded-full bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">
                Suggested
              </span>
            )}
            <Check size={14} className="shrink-0 text-accent opacity-0 transition group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ink-faint transition hover:bg-panel-2 hover:text-ink-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Deny's recoverable landing: the tour can't go on without access, so this
 *  explains the block and offers a one-click way back to the prompt. */
function DeniedView({
  kind,
  connectorLabel,
  projectName,
  onRetry,
}: {
  kind: 'workspace' | 'repo' | 'project'
  connectorLabel: string
  projectName: string
  onRetry: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
        <ShieldAlert size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium leading-snug text-ink">Access denied</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
          {kind === 'workspace'
            ? 'Claude can’t open a workspace without a folder to work in.'
            : kind === 'project'
              ? `Claude can’t create the ${projectName} project without your approval.`
              : `Claude can’t connect ${connectorLabel} without your approval.`}{' '}
          The tour pauses here until you grant access.
        </p>
        <div className="mt-2.5 flex items-center justify-end">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-strong"
          >
            Grant access
          </button>
        </div>
      </div>
    </div>
  )
}

/** A small keycap hint (Esc / Enter), matching the desktop prompt's affordances. */
function Key({ children, tone }: { children: React.ReactNode; tone?: 'onAccent' }) {
  return (
    <kbd
      className={`rounded px-1 py-0.5 text-[10px] font-medium leading-none ${
        tone === 'onAccent' ? 'bg-white/20 text-white/90' : 'bg-panel-2 text-ink-faint'
      }`}
    >
      {children}
    </kbd>
  )
}
