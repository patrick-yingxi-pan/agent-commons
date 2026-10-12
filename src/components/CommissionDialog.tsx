import { useRef, useState } from 'react'
import { Cpu } from 'lucide-react'
import { projectAdmittedAuthority } from '../../contract/isolation.ts'
import { PROJECT_ROLES, type ProjectRole, type Commission } from '../../contract/index.ts'
import type { Project } from '../data/cowork.ts'
import { updateCommissionConfiguration } from '../controller/commissionMutations.ts'
import { CheckboxRow } from './Checkbox.tsx'
import { FormDialog } from './FormDialog.tsx'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import type { ReactNode } from 'react'

export function CommissionDialog({
  commission,
  project,
  onClose,
  standingNotice,
}: {
  commission: Commission
  project: Project
  onClose: () => void
  standingNotice: ReactNode
}) {
  // Freeze the opening base. Ambient commission.changed events may refresh the
  // row behind this held draft; dirty comparison remains the user's own intent.
  const original = useRef(commission).current
  const admitted = projectAdmittedAuthority(project.contexts)
  const admittedConnectors = admitted.connectors ?? []
  const admittedScopes = admitted.scopes ?? []
  const startSet = (granted: string[] | undefined, all: string[]) =>
    new Set(!granted || granted.includes('*') ? all : granted)
  const [connectors, setConnectors] = useState<Set<string>>(() => startSet(commission.authority?.connectors, admittedConnectors))
  const [scopes, setScopes] = useState<Set<string>>(() => startSet(commission.authority?.scopes, admittedScopes))
  const [role, setRole] = useState<ProjectRole>(commission.role ?? 'writer')
  const [standing, setStanding] = useState(commission.standing === true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sameSet = (left: Set<string>, right: Set<string>): boolean =>
    left.size === right.size && [...left].every((value) => right.has(value))
  const originalConnectors = startSet(original.authority?.connectors, admittedConnectors)
  const originalScopes = startSet(original.authority?.scopes, admittedScopes)
  const connectorsChanged = !sameSet(connectors, originalConnectors)
  const scopesChanged = !sameSet(scopes, originalScopes)
  const roleChanged = role !== (original.role ?? 'writer')
  const standingChanged = standing !== (original.standing === true)
  const hasChanges = roleChanged || standingChanged || connectorsChanged || scopesChanged

  const toggle = (setFn: typeof setConnectors) => (value: string) =>
    setFn((prev) => {
      const next = new Set(prev)
      next.has(value) ? next.delete(value) : next.add(value)
      return next
    })

  const submit = async () => {
    if (busy || !hasChanges) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await updateCommissionConfiguration(commission.id, commission.projectId, {
        ...(roleChanged ? { role } : {}),
        ...(standingChanged ? { standing } : {}),
        ...(connectorsChanged || scopesChanged ? {
          authority: {
            ...(connectorsChanged ? { connectors: [...connectors] } : {}),
            ...(scopesChanged ? { scopes: [...scopes] } : {}),
          },
        } : {}),
      })
      if (outcome === 'discarded') {
        setError('Your held edits were not saved. Review the latest contributor, then apply what you still want.')
        setBusy(false)
        return
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this contributor.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title="Edit contributor"
      icon={<Cpu size={18} className="text-ink-soft" />}
      submitLabel="Save"
      canSubmit={hasChanges && !busy}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy}
    >
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium text-ink-soft" htmlFor="commission-role">
          Project role
        </label>
        <select id="commission-role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} className={FORM_INPUT_CLASS}>
          {PROJECT_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          The permission baseline: a reader may read; writer &amp; maintainer may fire effects and
          reserve sub-goals; owner may also commission others.
        </p>
      </div>
      <CheckboxRow checked={standing} onToggle={() => setStanding(!standing)} className="mb-3">
        <span className="text-[12px] leading-snug text-ink-soft">
          <span className="font-medium text-ink">Standing</span> — configure this Agent as a volunteer for the Project’s open work.
        </span>
      </CheckboxRow>
      {standingNotice}
      <div className="space-y-3">
        <AdmittedChecklist
          label="Connectors this contributor may reach"
          admitted={admittedConnectors}
          selected={connectors}
          onToggle={toggle(setConnectors)}
          emptyText="This project admits no connectors."
        />
        <AdmittedChecklist
          label="File scopes this contributor may reach"
          admitted={admittedScopes}
          selected={scopes}
          onToggle={toggle(setScopes)}
          emptyText="This project admits no folders or repos."
        />
        <p className="text-[11px] text-ink-faint">
          The Project’s admitted set is the wall; unchecking narrows this Contributor’s reach below it.
        </p>
      </div>
    </FormDialog>
  )
}

function AdmittedChecklist({
  label,
  admitted,
  selected,
  onToggle,
  emptyText,
}: {
  label: string
  admitted: string[]
  selected: Set<string>
  onToggle: (value: string) => void
  emptyText: string
}) {
  return <div>
    <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{label}</span>
    {admitted.length === 0 ? <p className="text-[12px] text-ink-faint">{emptyText}</p> :
      <div className="space-y-1.5">{admitted.map((value) =>
        <CheckboxRow key={value} checked={selected.has(value)} onToggle={() => onToggle(value)} className="text-[13px] text-ink">{value}</CheckboxRow>,
      )}</div>}
  </div>
}
