import { useRef, useState } from 'react'
import { AlertCircle, Bot } from 'lucide-react'
import type { Agent, PromptProbeResult } from '../../contract/index.ts'
import { defaultEntry, promptFitWarning } from '../../contract/index.ts'
import { useAgentToolCatalog, useMe, useProviders, useSystemPrompts } from '../api/hooks.ts'
import { probePrompt } from '../api/commands.ts'
import { enqueueAgentCreation } from '../controller/agentCreationMutations.ts'
import { updateAgent } from '../controller/agentMutations.ts'
import { CheckboxRow } from './Checkbox.tsx'
import { FormDialog, FormField } from './FormDialog.tsx'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'

/** Create / edit an Agent — the bundle that binds a Model provider (D9) to a system
 * prompt (D10). Both pickers pre-select the registry's *default-flagged* entry, else
 * the first listed (`defaultEntry` — the flag is exactly this pre-selection and
 * nothing more); there is NO implicit "Default" option, because the API refuses an
 * agent without concrete bindings (the strict-API rule). The prompt's fit against the
 * chosen provider's family is checked live (the same `promptFitWarning` the Customize
 * picker uses). New agents inherit the provider's authority + the full tool catalog;
 * per-axis authority editing is a later refinement. */
export function AgentDialog({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  // Freeze the form's opening base. Ambient Agent events may update the page
  // behind this held draft; dirty-field comparison must not reinterpret those
  // remote changes as edits the user made here.
  const original = useRef(agent).current
  const tenantId = useMe().data?.tenant.id
  const providers = useProviders().data ?? []
  const prompts = useSystemPrompts().data ?? []
  const catalog = useAgentToolCatalog().data?.tools ?? []
  const [label, setLabel] = useState(agent?.label ?? '')
  const [providerId, setProviderId] = useState(agent?.providerId ?? '')
  const [promptId, setPromptId] = useState(agent?.systemPromptId ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [providerTouched, setProviderTouched] = useState(false)
  const [promptTouched, setPromptTouched] = useState(false)
  // The tool grant is EXPLICIT (INV-9 minimal risk: the API treats an omitted grant as
  // NO tools, never the catalog) — so the dialog states it: a new agent pre-checks the
  // full catalog (the visible edge convenience); an edit starts at 'keep' and only
  // sends the grant when the user actually flips it (per-tool editing is a later
  // refinement — a custom subset is preserved unless changed).
  const [toolChoice, setToolChoice] = useState<'keep' | 'all' | 'none'>(agent ? 'keep' : 'all')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The opt-in prompt-fit probe (D10/OQ5) — null until the user runs it; reset when the
  // pairing changes so a stale score never lingers.
  const [probe, setProbe] = useState<PromptProbeResult | null>(null)
  const [probing, setProbing] = useState(false)

  // New-Agent pickers resolve to the default-else-first entry after async registry
  // load. An existing imported Agent with no provider stays visibly unbound until
  // the user chooses one; otherwise a sparse rename would display a provider it did
  // not save. A BESPOKE prompt similarly keeps its explicit "keep current" option.
  const bespokePrompt = !!agent && !agent.systemPromptId
  const effectiveProviderId = providerId || (!agent ? defaultEntry(providers)?.id : '') || ''
  const effectivePromptId = promptId || (bespokePrompt ? '' : defaultEntry(prompts)?.id || '')
  // What the grant checkbox shows: 'keep' reflects the agent's current grant.
  // "Has the full catalog" is a SET test (every catalog tool granted), not a
  // length compare — a same-size custom subset (or a grant carrying a stale tool
  // not in the catalog) must not read as full.
  const agentHasFullCatalog = !!original && catalog.length > 0 && catalog.every((t) => original.tools.includes(t))
  // A custom subset worth PRESERVING when the user unchecks (neither empty nor full).
  const agentHasCustomSubset = !!original && original.tools.length > 0 && !agentHasFullCatalog
  const grantAll = toolChoice === 'all' || (toolChoice === 'keep' && agentHasFullCatalog)
  const providerChanged = providerTouched && effectiveProviderId !== (original?.providerId ?? '')
  const promptChanged = promptTouched && effectivePromptId !== (original?.systemPromptId ?? '')
  const selectedTools = toolChoice === 'all' ? catalog : []
  const toolsChanged = toolChoice !== 'keep' && (
    selectedTools.length !== (original?.tools.length ?? 0) ||
    selectedTools.some((tool) => !original?.tools.includes(tool))
  )
  const hasEditChanges = !!agent && (
    label.trim() !== (original?.label ?? '') ||
    instructions.trim() !== (original?.instructions ?? '') ||
    providerChanged ||
    promptChanged ||
    toolsChanged
  )
  const canSubmit =
    label.trim().length > 0 &&
    !!effectiveProviderId &&
    (bespokePrompt || !!effectivePromptId) &&
    // A full-catalog grant needs the catalog loaded — never send [] while showing "all".
    (toolChoice !== 'all' || catalog.length > 0) &&
    (!!agent || !!tenantId) &&
    (!agent || hasEditChanges) &&
    !busy

  // Live fit warning: the chosen prompt's family vs the chosen provider's.
  const providerFamily = providers.find((p) => p.id === effectiveProviderId)?.modelFamily ?? 'claude'
  const selectedPrompt = prompts.find((p) => p.id === effectivePromptId)
  const warning = selectedPrompt ? promptFitWarning(selectedPrompt, providerFamily) : null
  // Changing either side of the pairing invalidates a prior probe result.
  const onPrompt = (id: string) => { setPromptId(id); setPromptTouched(true); setProbe(null) }
  const onProvider = (id: string) => { setProviderId(id); setProviderTouched(true); setProbe(null) }
  const runProbe = async () => {
    if (!effectivePromptId) return
    setProbing(true)
    try {
      setProbe(await probePrompt(effectivePromptId, effectiveProviderId || undefined))
    } catch {
      setProbe(null)
    } finally {
      setProbing(false)
    }
  }

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (agent) {
        // Sparse by USER intent, not by the live prop: after another device
        // changes an untouched field, Retry rebases only what this form actually
        // changed instead of replaying a stale full-form snapshot over it.
        const fields = {
          ...(label.trim() !== (original?.label ?? '') ? { label: label.trim() } : {}),
          ...(providerChanged ? { providerId: effectiveProviderId } : {}),
          ...(promptChanged ? { systemPromptId: effectivePromptId } : {}),
          ...(toolsChanged ? { tools: selectedTools } : {}),
          ...(instructions.trim() !== (original?.instructions ?? '') ? { instructions: instructions.trim() } : {}),
        }
        const outcome = await updateAgent(agent.id, fields)
        if (outcome === 'discarded') {
          setError('Your held edits were not saved. Review the latest agent, then apply what you still want.')
          setBusy(false)
          return
        }
      } else {
        const outcome = await enqueueAgentCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(),
            providerId: effectiveProviderId,
            systemPromptId: effectivePromptId,
            tools: grantAll ? catalog : [],
            instructions: instructions.trim(),
          },
        })
        if (outcome === 'discarded') {
          setError('Your Agent details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this agent.')
      setBusy(false)
    }
  }

  return (
    <FormDialog
      title={agent ? 'Edit agent' : 'New agent'}
      icon={<Bot size={18} className="text-ink-soft" />}
      submitLabel={agent ? 'Save' : 'Create'}
      canSubmit={canSubmit}
      onSubmit={submit}
      onClose={onClose}
      error={error}
      busy={busy}
    >
      <FormField label="Name">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. Code reviewer"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Provider">
        {/* No implicit option: every agent names a concrete provider (the strict-API
            rule); the pre-selected entry is the registry's default-else-first. */}
        <select value={effectiveProviderId} onChange={(e) => onProvider(e.target.value)} className={FORM_INPUT_CLASS}>
          {agent && !agent.providerId && <option value="" disabled>Choose a provider</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {/* The transport is visible at bind time (§4.6) — an <option>
                  can't carry the badge, so the cue rides the label text. The default
                  flag rides the same way. */}
              {`${p.label}${p.kind === 'session' ? ' · Session' : ''}${p.isDefault ? ' · Default' : ''}`}
            </option>
          ))}
        </select>
        {providers.find((p) => p.id === effectiveProviderId)?.kind === 'session' && (
          <span className="mt-1 flex items-start gap-1 text-[11px] text-ink-soft">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            Relay: your own AI session answers this Agent’s turns — tool calls are relayed through it (each still lands as a consent card here).
          </span>
        )}
      </FormField>
      <FormField label="System prompt">
        <select value={effectivePromptId} onChange={(e) => onPrompt(e.target.value)} className={FORM_INPUT_CLASS}>
          {/* The ONLY empty option is a bespoke-prompt agent's "keep current" (merged
              proposal, fork — no library binding to show). Left untouched, the patch
              omits the binding and the custom prompt is preserved. Everything else
              picks a concrete library entry — there is no implicit "Default prompt". */}
          {bespokePrompt && <option value="">Keep current prompt (custom)</option>}
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.label}${p.isDefault ? ' · Default' : ''}`}
            </option>
          ))}
        </select>
        {/* An agent needs a concrete prompt (the strict-API rule) — an emptied library
            would otherwise just disable Create with no explanation. */}
        {!bespokePrompt && prompts.length === 0 && (
          <span className="mt-1 block text-[11px] text-ink-faint">
            The prompt library is empty — add one under Agents → Prompts first.
          </span>
        )}
        {warning && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-warn-strong">
            <AlertCircle size={12} className="shrink-0" /> {warning}
          </span>
        )}
        {/* The opt-in probe (D10/OQ5) sits beside the always-on static tag above — the deeper,
            scored upgrade, run on demand. Only meaningful for a real library prompt. */}
        {selectedPrompt && (
          <div className="mt-1.5 flex flex-col gap-1">
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="self-start text-[11px] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
            >
              {probing ? 'Probing…' : probe ? 'Re-run fit probe' : 'Run fit probe'}
            </button>
            {probe && <ProbeResultCard probe={probe} />}
          </div>
        )}
      </FormField>
      <FormField label="Tools">
        {/* Unchecking RETURNS to the preserved custom subset when the agent has
            one (else it grants none) — so a check-then-uncheck can't silently
            destroy the subset the hint below promises to keep. */}
        <CheckboxRow checked={grantAll} onToggle={() => setToolChoice(grantAll ? (agentHasCustomSubset ? 'keep' : 'none') : 'all')}>
          <span className="text-[12px] leading-snug text-ink-soft">
            <span className="font-medium text-ink">Full tool catalog</span>
            {catalog.length > 0 ? ` — all ${catalog.length} tools` : ''}.{' '}
            {agentHasCustomSubset ? 'Unchecked keeps the current custom set' : (
              <>Unchecked grants <span className="font-medium text-ink">no tools</span> (the agent converses but can’t propose changes)</>
            )}. Per-tool selection is a later refinement.
          </span>
        </CheckboxRow>
        {toolChoice === 'keep' && agentHasCustomSubset && (
          <span className="mt-1 block text-[11px] text-ink-faint">
            Currently {agent!.tools.length} of {catalog.length || '…'} tools — the custom set is kept unless you change this.
          </span>
        )}
      </FormField>
      <FormField label="Instructions" optional>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Custom instructions appended after the system prompt."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
    </FormDialog>
  )
}

const PROBE_VERDICT_COLOR: Record<PromptProbeResult['verdict'], string> = {
  strong: 'text-ok-text', fair: 'text-warn-strong', weak: 'text-removed',
}

function ProbeResultCard({ probe }: { probe: PromptProbeResult }) {
  return <div className="rounded-md border border-ink/10 bg-ink/[0.02] p-2 text-[11px]">
    <div className={`font-medium ${PROBE_VERDICT_COLOR[probe.verdict]}`}>
      {probe.verdict} fit · {probe.score}/100
    </div>
    <div className="mt-0.5 text-ink-soft">{probe.detail}</div>
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-ink-faint">
      {probe.aspects.map((a) => <span key={a.name}>{a.name} <span className="font-medium text-ink-soft">{a.score}</span></span>)}
    </div>
  </div>
}
