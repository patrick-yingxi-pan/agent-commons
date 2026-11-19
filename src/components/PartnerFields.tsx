import { openAuthScreen } from '../controller/useAuthScreen'
import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import type { PartnerCapability } from '../../contract/taskPartners'
import type { QueryState } from '../api/cache'

export const roleNames: Record<PartnerCapability, string> = {
  'model-provider': 'Model provider',
  custodian: 'Reward custodian',
  verifier: 'Acceptance verifier',
}
export const applicationStates = {
  awaiting_proof: 'Proof required',
  sandbox_testing: 'Sandbox testing',
  in_review: 'In review',
  active: 'Active',
  rejected: 'Rejected',
  suspended: 'Suspended',
  revoked: 'Revoked',
}
export const environmentName = (env: string) => (env === 'sandbox' ? 'Sandbox' : 'Production')
export function PartnerField({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <label className="grid min-w-0 gap-1 text-sm text-ink">
      <span>{label}</span>
      <input {...props} className={FORM_INPUT_CLASS + ' w-full'} aria-describedby={hint ? id : undefined} />
      {hint && (
        <span id={id} className="text-xs text-ink-faint">
          {hint}
        </span>
      )}
    </label>
  )
}
export function PartnerSelect({
  label,
  value,
  onChange,
  children,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span>{label}</span>
      <select
        className={FORM_INPUT_CLASS + ' w-full'}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  )
}
export function PartnerNotice({
  action,
}: {
  action: { pending: boolean; error: string; notice: string; signInRequired?: boolean }
}) {
  return (
    <>
      {action.error && (
        <p role="alert" className="break-words text-sm text-removed">
          {action.error}
        </p>
      )}
      {action.signInRequired && (
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={() => openAuthScreen({ kind: 'signin' })}
        >
          Sign in again
        </button>
      )}
      <p role="status" className="text-sm text-ink-faint">
        {action.pending ? 'Working…' : action.notice}
      </p>
    </>
  )
}
export function PartnerQueryStatus({
  query,
  retry,
}: {
  query: Pick<QueryState<unknown>, 'status' | 'data' | 'error'>
  retry: () => void
}) {
  if (query.status === 'error')
    return (
      <div role="alert" className="space-y-2">
        <p>{query.error?.message ?? 'Could not load this information.'}</p>
        {(query.error as { status?: number })?.status === 401 && (
          <button
            className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
            onClick={() => openAuthScreen({ kind: 'signin' })}
          >
            Sign in
          </button>
        )}
        <button className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'} onClick={retry}>
          Try again
        </button>
      </div>
    )
  if (!query.data)
    return (
      <p role="status" className="text-sm text-ink-faint">
        Loading…
      </p>
    )
  return null
}
export function PartnerGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 border-t border-line py-4">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}
export function CopyPartnerValue({ label, value }: { label: string; value: string }) {
  const id = useId()
  async function copy() {
    const field = document.getElementById(id) as HTMLTextAreaElement
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      field.focus()
      field.select()
    }
  }
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <textarea id={id} className={FORM_INPUT_CLASS + ' w-full font-mono'} rows={2} value={value} readOnly />
      <button type="button" className={SECONDARY_BUTTON_CLASS + ' justify-self-start'} onClick={copy}>
        Copy {label.toLowerCase()}
      </button>
    </div>
  )
}

export function PartnerPagination({
  next,
  cursors,
  set,
}: {
  next?: string | null
  cursors: string[]
  set: (c: string[]) => void
}) {
  if (!next && !cursors.length) return null
  return (
    <nav aria-label="Results pages" className="flex gap-2">
      {cursors.length > 0 && (
        <button
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={() => set(cursors.slice(0, -1))}
        >
          Previous page
        </button>
      )}
      {next && (
        <button
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={() => set([...cursors, next])}
        >
          Next page
        </button>
      )}
    </nav>
  )
}

export function PartnerProfileName({
  name,
  path,
  origin,
}: {
  name: string
  path: string
  origin?: string | null
}) {
  if (!origin)
    return (
      <strong>
        <bdi>{name}</bdi>
      </strong>
    )
  return (
    <a
      className="font-semibold underline"
      href={new URL(path, origin).href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <bdi>{name}</bdi>
    </a>
  )
}
