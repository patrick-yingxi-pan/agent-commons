import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { DISPATCH_DETAIL_MAX, DISPATCH_TITLE_MAX } from '../../contract/dispatchExecution.ts'
import { useAgents, useCapabilities, useMe, useProviders } from '../api/hooks.ts'
import { retryResourceQueries } from '../api/resourceRead.ts'
import { keys } from '../api/keys.ts'
import { enqueueDispatch, isDispatchHeld, useDispatchMutationStatus } from '../controller/dispatchMutations.ts'
import { dispatchPresentation } from '../lib/dispatchPresentation.ts'
import { modelProviderAvailable } from '../lib/modelExecution.ts'
import { AUTOMATION_NOTICE_CLASS } from '../lib/automationPresentation.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'
import { FormDialog, FormField } from './FormDialog.tsx'

/** One explicit execution binding, held with the task until acknowledgement. */
export function NewDispatchDialog({ onClose, onManageModelConnections }: { onClose: () => void; onManageModelConnections: () => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [agentId, setAgentId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const agents = useAgents()
  const providers = useProviders()
  useDispatchMutationStatus()
  const tenantId = useMe().data?.tenant.id
  const held = isDispatchHeld()
  const capabilities = useCapabilities()
  const dispatch = dispatchPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  const provider = providers.data?.find((candidate) => candidate.id === providerId && candidate.kind !== 'session')
  const bindingReady = agents.status !== 'error' && providers.status !== 'error' &&
    agents.data?.some((candidate) => candidate.id === agentId) && provider && modelProviderAvailable(provider) &&
    provider.models?.some((model) => model.id === modelId)

  const canCreate = dispatch.available && Boolean(bindingReady) && title.trim().length > 0 && Boolean(tenantId)
  const submit = () => {
    if (!canCreate || held || !tenantId) return
    const input = {
      tenantId,
      title: title.trim(),
      detail: detail.trim() || undefined,
      execution: { agentId, providerId, modelId },
    }
    void enqueueDispatch(input).then((outcome) => {
      if (outcome === 'applied') onClose()
    })
  }

  return (
    <FormDialog
      title="New dispatch"
      icon={<SendHorizontal size={18} className="text-cap-workspace" />}
      kind="dispatch-create"
      submitLabel="Dispatch"
      submitIcon={<SendHorizontal size={15} />}
      canSubmit={canCreate && !held}
      busy={held}
      onSubmit={submit}
      onClose={onClose}
    >
      <p role="note" data-dispatch-posture={dispatch.state} className={AUTOMATION_NOTICE_CLASS}>{dispatch.note}</p>
      <FormField label="Task">
        <input
          value={title}
          maxLength={DISPATCH_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="e.g. Draft a launch checklist"
          className={FORM_INPUT_CLASS}
        />
      </FormField>
      <FormField label="Detail" optional>
        <textarea
          value={detail}
          maxLength={DISPATCH_DETAIL_MAX}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          placeholder="Instructions and information the Agent needs."
          className={`${FORM_INPUT_CLASS} resize-none leading-relaxed`}
        />
      </FormField>
      <FormField label="Agent">
        <select value={agentId} onChange={(e) => setAgentId(e.currentTarget.value)} className={FORM_INPUT_CLASS}>
          <option value="">Choose an Agent</option>
          {(agents.data ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
        </select>
      </FormField>
      <FormField label="Model connection">
        <select value={providerId} onChange={(event) => { setProviderId(event.currentTarget.value); setModelId('') }} className={FORM_INPUT_CLASS}>
          <option value="">Choose a connection</option>
          {(providers.data ?? []).filter((candidate) => candidate.kind !== 'session').map((candidate) =>
            <option key={candidate.id} value={candidate.id}>{candidate.label}{modelProviderAvailable(candidate) ? '' : ' — needs setup'}</option>)}
        </select>
      </FormField>
      <FormField label="Model">
        <select value={modelId} disabled={!provider} onChange={(event) => setModelId(event.currentTarget.value)} className={FORM_INPUT_CLASS}>
          <option value="">Choose a model</option>
          {(provider?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </FormField>
      <p role="status" className="text-[12px] leading-relaxed text-ink-soft">
        {agents.status === 'error' || providers.status === 'error'
          ? 'Agent or model choices could not be loaded. Your draft is kept.'
          : provider?.execution === 'mock' ? 'Development model: this runs through the conversation engine using a deterministic local fixture.'
            : provider && !modelProviderAvailable(provider) ? 'This connection needs setup before it can run.'
              : 'Uses the selected Agent’s instructions and permitted workspace tools. No context is attached initially; open the conversation to add it or review actions.'}
      </p>
      {(agents.status === 'error' || providers.status === 'error') && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => retryResourceQueries([keys.workerAgents, keys.providers])}>Retry choices</button>}
      <button type="button" className={INLINE_ACTION_CLASS} onClick={() => { onClose(); onManageModelConnections() }}>Manage model connections</button>
    </FormDialog>
  )
}
