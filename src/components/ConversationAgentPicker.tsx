import { useAgents, invalidate, keys } from '../api'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'

/** Loaded with the catalog, not the closed composer. Registry truth owns every
 * option, including the built-in default; a dangling binding remains explicit. */
export function ConversationAgentPicker({ agentId, onSelect, disabled }: {
  agentId: string
  onSelect?: (agentId: string) => void
  disabled?: boolean
}) {
  const query = useAgents()
  const agents = query.data ?? []
  const available = agents.some((agent) => agent.id === agentId)
  return <div className="border-b border-line px-3 py-2">
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Conversation Agent</span>
      <select aria-label="Conversation Agent" value={agentId}
        disabled={disabled || !onSelect || !query.data || !!query.error}
        onChange={(event) => onSelect?.(event.currentTarget.value)}
        className={`${FORM_INPUT_CLASS} mt-1 w-full`}>
        {!available && <option value={agentId}>{query.data ? 'Unavailable Agent' : 'Loading Agents…'}</option>}
        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
      </select>
    </label>
    {query.error && <div role="alert" className="mt-2 text-[12px] text-danger-text">
      <p>Couldn’t load Agents. Your selection hasn’t changed.</p>
      <button className={`${SECONDARY_BUTTON_CLASS} mt-1 px-2 py-1 text-[12px]`}
        onClick={() => invalidate(keys.workerAgents)}>Retry Agent choices</button>
    </div>}
    <p className="mt-1 text-[11px] leading-snug text-ink-soft">Changing Agent uses its configured model for future replies. Earlier replies stay unchanged. You can override the model below.</p>
  </div>
}
