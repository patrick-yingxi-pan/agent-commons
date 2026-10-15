import type { AgentRequestArgumentDraftBinding, AgentRequestReview, AgentRequestView } from '../../contract/agentRequests.ts'
import { decideRequest } from '../controller/agentRequestActions.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { namedReadRegionProps } from '../lib/dialog.ts'

type SelectedTool = AgentRequestReview['tools'][number]
function bindingFor(review: AgentRequestReview, chosen: SelectedTool | undefined): AgentRequestArgumentDraftBinding | undefined {
  const model = review.draftModel
  if (!model || !chosen) return undefined
  return { agentRevision: model.agentRevision, providerId: model.providerId, providerRevision: model.providerRevision,
    providerConnectionRevision: model.providerConnectionRevision, model: model.model,
    connectionId: chosen.connectionId, connectionRevision: chosen.connectionRevision, toolName: chosen.tool.name,
    schemaHash: chosen.schemaHash, transport: chosen.transport }
}
const button = `${SECONDARY_BUTTON_CLASS} px-3 py-2 text-[13px]`

/** Advice is never applied on receipt. The person must explicitly replace the
 * editor and separately review the resulting exact call before running it. */
export function AgentRequestArgumentDraft({ row, review, chosen, held, onUse }: {
  row: AgentRequestView
  review: AgentRequestReview
  chosen: SelectedTool | undefined
  held: boolean
  onUse: (argumentsJson: string) => void
}) {
  const draft = row.argumentDraft, binding = bindingFor(review, chosen)
  const current = binding && draft && Object.keys(binding).every(key =>
    binding[key as keyof typeof binding] === draft.binding[key as keyof typeof binding])
  if (!chosen && !draft) return null
  return <section aria-label="Optional argument draft" className="space-y-2 rounded-lg border border-line p-3 text-[13px] text-ink-soft [overflow-wrap:anywhere]">
    <h3 className="font-medium text-ink">Let your Agent draft the arguments</h3>
    {draft && <p data-agent-request-draft-binding>Saved attempt: <code>{draft.binding.toolName}</code> · Model: {draft.binding.model}</p>}
    {!draft ? <>
      {review.draftModel ? <>
        <p>This sends the requested outcome, this Agent’s instructions and the selected tool’s description and schema to {review.draftModel.providerLabel} · {review.draftModel.model}. It sends no conversation history, connection credentials or tool results.</p>
        <p>Your workspace pays for model usage. One attempt per request; local token limits are not a billing cap. Drafting does not run the tool or share a reply.</p>
        <button className={button} disabled={held || !binding} onClick={() => {
          if (binding && !held) decideRequest(row.id, { action: 'draft-arguments', expectedRevision: row.revision, binding })
        }}>Draft arguments</button>
      </> : <p>Optional drafting needs a configured endpoint model for this Agent. You can still enter arguments yourself.</p>}
    </> : draft.status === 'pending' ? <p role="status">Drafting arguments… No tool is running. You can cancel the request; a model call already sent may still be charged.</p> : draft.status === 'done' ? <>
      <p>Suggested arguments · private to you. Check every value; model output can be wrong.</p>
      <pre {...namedReadRegionProps('Suggested arguments', 'agent-request')} className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[12px] text-ink">{JSON.stringify(draft.arguments, null, 2)}</pre>
      {current ? <><p>Use draft replaces the argument editor. You can edit it before reviewing the call.</p><button className={button} disabled={held} onClick={() => { if (!held) onUse(JSON.stringify(draft.arguments, null, 2)) }}>Use draft</button></> :
        <p role="status">The Agent, model or selected tool has changed. This suggestion is retained as history; enter arguments manually.</p>}
    </> : <p role="status">{draft.status === 'uncertain' ? 'The model outcome is uncertain.' : 'No usable argument draft was returned.'} The attempt will not repeat. Model usage may have been charged. You can still enter arguments yourself.</p>}
  </section>
}
