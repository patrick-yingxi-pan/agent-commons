/** The account chip + menu (multi-account §6.6; §12: the switcher). The chip
 *  label is always `/v1/me` — the server's word for who it heard, so a switch,
 *  a signup, or a sign-in becomes VISIBLE TRUTH, never an optimistic label.
 *
 *  The menu's sections, top to bottom:
 *    • Accounts — every account SIGNED IN on this browser (the account stack,
 *      `GET /v1/auth/accounts`): instant, credential-less hops (GitHub-style),
 *      plus "Add account…" which opens the full-screen sign-in flow.
 *    • Your workspaces — the signed-in account's real memberships
 *      (`GET /v1/me/workspaces`); a pick re-mints the session for that tenant.
 *      Plus an inline "New workspace" form (`POST /v1/workspaces`).
 *    • Switch identity (dev) — the SEEDED directory (`GET /v1/identities`);
 *      real accounts never appear here (they sign in). Rows for the current
 *      user are elided (their workspaces section already covers them).
 *    • Sign in / Create account / Sign out — sign-in and sign-up open the
 *      DEDICATED full-screen flow (§12 — src/components/auth/AuthScreen.tsx);
 *      sign-out clears the session and lands on the account picker.
 *
 *  All dismissal via useDismissable (the shared hook — design invariant); the
 *  inline workspace form wears the shared auth-form primitives (authFlow.ts). */
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  createWorkspace,
  signOut,
  switchActiveAccount,
  switchToAccount,
  useAuthAccounts,
  useCapabilities,
  useIdentities,
  useMe,
  useMyWorkspaces,
} from '../api'
import { openAuthScreen } from '../controller/useAuthScreen'
import { AUTH_ERROR_CLASS, AUTH_INPUT_CLASS, AUTH_PRIMARY_CLASS } from '../lib/authFlow'
import { useDismissable } from '../lib/useDismissable'
import { SIDEBAR_HOVER } from '../lib/sidebar'

type Mode = 'menu' | 'workspace'

export function AccountChip() {
  const me = useMe().data
  const switchable = useCapabilities().data?.features.identitySwitch === true
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const menuRef = useDismissable<HTMLDivElement>(open, () => {
    setOpen(false)
    setMode('menu')
  })
  const name = me?.user.name ?? 'You'
  const workspace = me?.tenant.name ?? 'Personal'
  const initial = name.trim().charAt(0).toUpperCase() || 'Y'
  const identityRow = (
    <div className="flex items-center gap-2" title={me?.user.email}>
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
        {initial}
      </div>
      <div className="leading-tight">
        <div className="text-xs font-medium text-ink">{name}</div>
        <div className="text-[11px] text-ink-faint">{workspace}</div>
      </div>
    </div>
  )
  if (!switchable) {
    return <div className="border-t border-line px-3 py-2.5">{identityRow}</div>
  }
  const close = () => {
    setOpen(false)
    setMode('menu')
  }
  return (
    <div className="relative border-t border-line px-3 py-2.5" ref={menuRef}>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {mode === 'menu' && <MenuBody me={me} onMode={setMode} onClose={close} />}
          {mode === 'workspace' && (
            <WorkspaceForm
              onBack={() => setMode('menu')}
              onDone={close}
            />
          )}
        </div>
      )}
      <button
        data-testid="account-chip"
        onClick={() => setOpen((o) => !o)}
        className={`-mx-1 w-[calc(100%+0.5rem)] rounded-lg px-1 py-0.5 text-left transition ${SIDEBAR_HOVER}`}
        aria-label="Switch account"
      >
        {identityRow}
      </button>
    </div>
  )
}

function MenuBody({
  me,
  onMode,
  onClose,
}: {
  me: ReturnType<typeof useMe>['data']
  onMode: (m: Mode) => void
  onClose: () => void
}) {
  const workspaces = useMyWorkspaces().data ?? []
  const identities = useIdentities(true).data ?? []
  const stacked = useAuthAccounts().data ?? []
  const signedIn = me?.via === 'session'
  // The seed directory, minus the current user's rows — their real memberships
  // above already cover those (no duplicate switch targets).
  const seedRows = identities.filter((i) => i.userId !== me?.user.id)
  return (
    <>
      {stacked.length > 0 && (
        <>
          <SectionLabel>Accounts</SectionLabel>
          {stacked.map((a) => (
            <Row
              key={a.user.id}
              testid="account-stack-option"
              active={a.current}
              onClick={() => {
                onClose()
                if (!a.current) void switchToAccount(a.user.id)
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                {a.user.name}
                <span className="ml-1 text-[10px] text-ink-faint">{a.tenant.name}</span>
              </span>
              {a.current && <span className="text-[10px] text-ink-faint">Active</span>}
            </Row>
          ))}
          <Row
            testid="auth-add-account"
            onClick={() => {
              onClose()
              openAuthScreen({ kind: 'signin', addAccount: true })
            }}
          >
            + Add account…
          </Row>
        </>
      )}
      <SectionLabel>Your workspaces</SectionLabel>
      {workspaces.map((w) => {
        const active = w.tenant.id === me?.tenant.id
        return (
          <Row
            key={w.tenant.id}
            testid="workspace-option"
            active={active}
            onClick={() => {
              onClose()
              if (!active && me) void switchActiveAccount({ userId: me.user.id, tenantId: w.tenant.id })
            }}
          >
            <span className="flex-1">
              {w.tenant.name}
              <span className="ml-1 text-[10px] text-ink-faint">{w.role}</span>
            </span>
            {active && <span className="text-[10px] text-ink-faint">Active</span>}
          </Row>
        )
      })}
      <Row testid="workspace-new" onClick={() => onMode('workspace')}>
        + New workspace…
      </Row>
      {seedRows.length > 0 && (
        <>
          <SectionLabel>Switch identity (dev)</SectionLabel>
          {seedRows.map((i) => (
            <Row
              key={`${i.userId}:${i.tenantId}`}
              testid="account-option"
              onClick={() => {
                onClose()
                void switchActiveAccount({ userId: i.userId, tenantId: i.tenantId })
              }}
            >
              <span className="flex-1">
                {i.userLabel}
                <span className="ml-1 text-[10px] text-ink-faint">{i.tenantLabel}</span>
              </span>
            </Row>
          ))}
        </>
      )}
      <SectionLabel>Account</SectionLabel>
      {!signedIn && (
        <>
          <Row
            testid="auth-signin"
            onClick={() => {
              onClose()
              openAuthScreen({ kind: 'signin' })
            }}
          >
            Sign in…
          </Row>
          <Row
            testid="auth-signup"
            onClick={() => {
              onClose()
              openAuthScreen({ kind: 'signup' })
            }}
          >
            Create account…
          </Row>
        </>
      )}
      {signedIn && (
        <Row
          testid="auth-signout"
          onClick={async () => {
            onClose()
            // Sign out server-side FIRST (the stack forgets this account), then
            // land on the picker — the remaining accounts (or the sign-in form
            // when none remain) are the natural next step, GitHub-style.
            await signOut()
            openAuthScreen({ kind: 'picker' })
          }}
        >
          Sign out
        </Row>
      )}
    </>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{children}</div>
}

function Row({
  children,
  onClick,
  active,
  testid,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  testid: string
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
      }`}
    >
      {children}
    </button>
  )
}

/** The inline "New workspace" form — the one auth-adjacent flow that STAYS in
 *  the menu (it acts on the signed-in account; no identity transition). Wears
 *  the shared auth-form primitives (authFlow.ts) so it and the full-screen
 *  flow can't drift apart. Submits on Enter; the API's error shows verbatim. */
function WorkspaceForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await createWorkspace(name)
    setBusy(false)
    if (r.ok) onDone()
    else setError(r.message)
  }
  return (
    <form onSubmit={submit} className="space-y-1.5 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink">New workspace</span>
        <button type="button" onClick={onBack} className="text-[11px] text-ink-faint hover:text-ink">
          Back
        </button>
      </div>
      <input
        data-testid="auth-name"
        type="text"
        placeholder="Workspace name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={AUTH_INPUT_CLASS}
      />
      {error && (
        <p data-testid="auth-error" className={AUTH_ERROR_CLASS}>
          {error}
        </p>
      )}
      <button type="submit" data-testid="auth-submit" disabled={busy || !name.trim()} className={AUTH_PRIMARY_CLASS}>
        {busy ? 'Working…' : 'Create workspace'}
      </button>
    </form>
  )
}
