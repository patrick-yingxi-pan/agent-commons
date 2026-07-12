/** The account chip + menu (multi-account §6.6; §12: the switcher). The chip
 *  label is always `/v1/me` — the server's word for who it heard, so a switch,
 *  a signup, or a sign-in becomes VISIBLE TRUTH, never an optimistic label.
 *
 *  The menu's sections, top to bottom:
 *    • Accounts — every account SIGNED IN on this browser (the account stack,
 *      `GET /v1/auth/accounts`): instant, credential-less hops (GitHub-style),
 *      plus "Add account…" which opens the full-screen sign-in flow.
 *    • Sign in / Create account / Sign out — sign-in and sign-up open the
 *      DEDICATED full-screen flow (§12 — src/components/auth/AuthScreen.tsx);
 *      sign-out clears the session and lands on the account picker.
 *
 *  The old "Your workspaces" section (workspace re-mints + the inline "New
 *  workspace" form) is gone — FWD-5 Phase 2, the workspace collapse: an account
 *  IS its one namespace, so the only thing to switch is the ACCOUNT
 *  (docs/design/principals-and-namespaces.md). All dismissal via useDismissable
 *  (the shared hook — design invariant). */
import { useState, type ReactNode } from 'react'
import { signOut, switchToAccount, useAuthAccounts, useCapabilities, useMe } from '../api'
import { openAuthScreen } from '../controller/useAuthScreen'
import { useDismissable } from '../lib/useDismissable'
import { SIDEBAR_HOVER } from '../lib/sidebar'

export function AccountChip() {
  const me = useMe().data
  const switchable = useCapabilities().data?.features.identitySwitch === true
  const [open, setOpen] = useState(false)
  const menuRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const name = me?.user.name ?? 'You'
  const namespace = me?.tenant.name ?? 'Personal'
  const initial = name.trim().charAt(0).toUpperCase() || 'Y'
  const identityRow = (
    <div className="flex items-center gap-2" title={me?.user.email}>
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
        {initial}
      </div>
      <div className="leading-tight">
        <div className="text-xs font-medium text-ink">{name}</div>
        <div className="text-[11px] text-ink-faint">{namespace}</div>
      </div>
    </div>
  )
  if (!switchable) {
    return <div className="border-t border-line px-3 py-2.5">{identityRow}</div>
  }
  const close = () => setOpen(false)
  return (
    <div className="relative border-t border-line px-3 py-2.5" ref={menuRef}>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
          <MenuBody me={me} onClose={close} />
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

function MenuBody({ me, onClose }: { me: ReturnType<typeof useMe>['data']; onClose: () => void }) {
  const stacked = useAuthAccounts().data ?? []
  const signedIn = me?.via === 'session'
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
