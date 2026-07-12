/** The account chip + menu (multi-account §6.6; §12: the switcher). The chip
 *  label is always `/v1/me` — the server's word for who it heard, so a switch,
 *  a signup, or a sign-in becomes VISIBLE TRUTH, never an optimistic label.
 *
 *  The menu's sections, top to bottom:
 *    • Invitations — the caller's PENDING org invites (FWD-6 O-D3, the v1
 *      door): accept mints the seat and re-reads the world; decline closes.
 *    • Organizations — the caller's org SEATS. Every row is a DOOR to the
 *      org's namespace page (D21 — openOwner), NEVER a switch: an org is a
 *      namespace, not a world (FWD-6 O-D1; the deleted workspace rows re-minted
 *      the session — these navigate). Plus the inline "New organization…" form.
 *    • Accounts — every account SIGNED IN on this browser (the account stack,
 *      `GET /v1/auth/accounts`), in SIGN-IN ORDER — switching never reorders
 *      the rows (the server's stack merge is in-place, server/auth.ts). Each
 *      row is an instant, credential-less hop (GitHub-style) and carries a
 *      HOVER sign-out: on the active account it's the full sign-out (session
 *      clears, land on the picker); on any other it just forgets that account
 *      here (DELETE /v1/auth/accounts/:id). "Add account…" is the menu's last
 *      line — there is no separate "Account" section; when nothing is signed
 *      in, Sign in… / Create account… stand in its place (both open the
 *      dedicated full-screen flow, §12 — src/components/auth/AuthScreen.tsx).
 *
 *  The old "Your workspaces" section (workspace re-mints + the inline "New
 *  workspace" form) is gone — FWD-5 Phase 2, the workspace collapse: an account
 *  IS its one namespace, so the only thing to switch is the ACCOUNT
 *  (docs/design/principals-and-namespaces.md). All dismissal via useDismissable
 *  (the shared hook — design invariant). */
import { useState, type FormEvent, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import {
  createOrg,
  forgetAccount,
  resolveMyInvite,
  signOut,
  switchToAccount,
  useAuthAccounts,
  useCapabilities,
  useMe,
  useMyInvites,
  useMyOrgs,
} from '../api'
import { openAuthScreen } from '../controller/useAuthScreen'
import { AUTH_ERROR_CLASS, AUTH_INPUT_CLASS, AUTH_PRIMARY_CLASS } from '../lib/authFlow'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { useDismissable } from '../lib/useDismissable'
import { SIDEBAR_HOVER } from '../lib/sidebar'

export function AccountChip({ onOpenOwner }: { onOpenOwner?: (name: string) => void }) {
  const me = useMe().data
  const switchable = useCapabilities().data?.features.identitySwitch === true
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'neworg'>('menu')
  const menuRef = useDismissable<HTMLDivElement>(open, () => {
    setOpen(false)
    setMode('menu')
  })
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
  const close = () => {
    setOpen(false)
    setMode('menu')
  }
  return (
    <div className="relative border-t border-line px-3 py-2.5" ref={menuRef}>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {mode === 'menu' && <MenuBody me={me} onClose={close} onNewOrg={() => setMode('neworg')} onOpenOwner={onOpenOwner} />}
          {mode === 'neworg' && <NewOrgForm onBack={() => setMode('menu')} onDone={close} onOpenOwner={onOpenOwner} />}
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
  onClose,
  onNewOrg,
  onOpenOwner,
}: {
  me: ReturnType<typeof useMe>['data']
  onClose: () => void
  onNewOrg: () => void
  onOpenOwner?: (name: string) => void
}) {
  const stacked = useAuthAccounts().data ?? []
  const orgs = useMyOrgs().data ?? []
  const invites = useMyInvites().data ?? []
  // A failed invite verdict (raced with a revoke) reports here; the hook already
  // re-read the list, so the stale row clears alongside the message.
  const [inviteError, setInviteError] = useState('')
  const verdict = async (id: string, action: 'accept' | 'decline') => {
    const r = await resolveMyInvite(id, action)
    setInviteError(r.ok ? '' : r.message)
  }
  const signedIn = me?.via === 'session'
  return (
    <>
      {(invites.length > 0 || inviteError) && (
        <>
          <SectionLabel>Invitations</SectionLabel>
          {invites.map((inv) => (
            <div key={inv.id} data-testid="org-invite-row" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-soft">
              <span className="min-w-0 flex-1 truncate">
                {inv.orgName}
                <span className="ml-1 text-[10px] text-ink-faint">from {inv.invitedBy}</span>
              </span>
              <button
                data-testid="org-invite-accept"
                onClick={() => void verdict(inv.id, 'accept')}
                className="font-medium text-accent-strong transition hover:underline"
              >
                Accept
              </button>
              <button
                data-testid="org-invite-decline"
                onClick={() => void verdict(inv.id, 'decline')}
                className="text-ink-faint transition hover:text-ink"
              >
                Decline
              </button>
            </div>
          ))}
          {inviteError && (
            <p data-testid="org-invite-error" className="px-2 py-1 text-[11px] text-removed">
              {inviteError}
            </p>
          )}
        </>
      )}
      {/* Always offered — founding needs only an identity (the desktop's
          credential-less default included); JOINING still needs a signed-in
          email for the invite to land. */}
      <SectionLabel>Organizations</SectionLabel>
      {orgs.map((o) => (
        <Row
          key={o.tenant.id}
          testid="org-option"
          onClick={() => {
            onClose()
            onOpenOwner?.(o.tenant.name) // a DOOR to the org's page — never a switch
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {o.tenant.name}
            <span className="ml-1 text-[10px] text-ink-faint">{o.role}</span>
          </span>
        </Row>
      ))}
      <Row testid="org-new" onClick={onNewOrg}>
        + New organization…
      </Row>
      {stacked.length > 0 && (
        <>
          <SectionLabel>Accounts</SectionLabel>
          {/* SIGN-IN ORDER, straight from the server (the stack merge is
              in-place) — never re-sorted here, active-first included: the rows
              must not shuffle under the pointer when a switch lands. */}
          {stacked.map((a) => (
            <div key={a.user.id} data-testid="account-stack-row" className="group relative">
              <button
                data-testid="account-stack-option"
                onClick={() => {
                  onClose()
                  if (!a.current) void switchToAccount(a.user.id)
                }}
                className={`${rowClass(a.current)} pr-8`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {a.user.name}
                  <span className="ml-1 text-[10px] text-ink-faint">{a.tenant.name}</span>
                </span>
                {a.current && <span className="text-[10px] text-ink-faint">Active</span>}
              </button>
              {/* The per-row sign-out — a real control, so HOVER_REVEAL (UI-7:
                  persistent on touch tiers; focus reveals it for the keyboard
                  path, WCAG 2.1.1). Active account: the full sign-out (session
                  clears, land on the picker). Any other: just forget it on
                  this browser — the menu stays put and re-reads. */}
              <button
                data-testid={a.current ? 'auth-signout' : 'account-stack-signout'}
                aria-label={a.current ? `Sign out of ${a.user.name}` : `Forget ${a.user.name} on this browser`}
                title={a.current ? 'Sign out' : 'Sign out of this account here'}
                onClick={async () => {
                  if (a.current) {
                    onClose()
                    // Sign out server-side FIRST (the stack forgets this account),
                    // then land on the picker — the remaining accounts (or the
                    // sign-in form when none remain) are next, GitHub-style.
                    await signOut()
                    openAuthScreen({ kind: 'picker' })
                  } else {
                    await forgetAccount(a.user.id)
                  }
                }}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
              >
                <LogOut size={12} aria-hidden />
              </button>
            </div>
          ))}
        </>
      )}
      {/* The menu's last line: adding is the one account-level act left down
          here (per-account sign-out lives on the rows above — no "Account"
          section). Signed out entirely, the same slot offers the doors in. */}
      {signedIn || stacked.length > 0 ? (
        <Row
          testid="auth-add-account"
          onClick={() => {
            onClose()
            openAuthScreen({ kind: 'signin', addAccount: true })
          }}
        >
          + Add account…
        </Row>
      ) : (
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
    </>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{children}</div>
}

/** The one menu-row look — Row and the stacked-account button (which needs a
 *  wrapper for its hover sign-out, so it can't BE a Row) share it verbatim. */
function rowClass(active?: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
    active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
  }`
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
    <button data-testid={testid} onClick={onClick} className={rowClass(active)}>
      {children}
    </button>
  )
}

/** The inline "New organization" form (FWD-6 O3). Wears the shared auth-form
 *  primitives (authFlow.ts) like every auth-adjacent form; on success the menu
 *  closes through the new org's DOOR (its namespace page). */
function NewOrgForm({
  onBack,
  onDone,
  onOpenOwner,
}: {
  onBack: () => void
  onDone: () => void
  onOpenOwner?: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await createOrg(name)
    setBusy(false)
    if (r.ok) {
      onDone()
      onOpenOwner?.(r.tenant.name)
    } else setError(r.message)
  }
  return (
    <form onSubmit={submit} className="space-y-1.5 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink">New organization</span>
        <button type="button" onClick={onBack} className="text-[11px] text-ink-faint hover:text-ink">
          Back
        </button>
      </div>
      <input
        data-testid="org-name"
        type="text"
        placeholder="Organization name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={AUTH_INPUT_CLASS}
      />
      {error && (
        <p data-testid="org-error" className={AUTH_ERROR_CLASS}>
          {error}
        </p>
      )}
      <button type="submit" data-testid="org-submit" disabled={busy || !name.trim()} className={AUTH_PRIMARY_CLASS}>
        {busy ? 'Working…' : 'Create organization'}
      </button>
    </form>
  )
}
