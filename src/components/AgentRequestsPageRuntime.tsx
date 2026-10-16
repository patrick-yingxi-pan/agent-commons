import { useEffect, useId, useState } from 'react'
import type { AgentRequestApproval, AgentRequestReview, AgentRequestView } from '../../contract/agentRequests.ts'
import { AGENT_REQUEST_TASK_MAX_BYTES, AGENT_REQUEST_REPLY_MAX_BYTES } from '../../contract/agentRequests.ts'
import type { NavLocation } from '../lib/nav.ts'
import { useAgentRequest, useAgentRequestOptions, useAgentRequestReview, refreshAgentRequests } from '../api/agentRequests.ts'
import { resolveResourceUnavailable } from '../api/resourceRead.ts'
import { checkAgentRequest, decideRequest, dismissAgentRequestAttempt, sendAgentRequest, setAgentRequestDraft, useAgentRequestActions } from '../controller/agentRequestActions.ts'
import { AtomicResourcePage, CompositeResourcePage, ResourcePageHeader, ResourceUnavailablePage } from './ResourcePage.tsx'
import { AgentRequestsSummary, RequestReadFailure as ReadFailure, requestStatusLabel as statusLabel } from './AgentRequestsSummaryRuntime.tsx'
import { CheckboxRow } from './Checkbox.tsx'
import { FORM_ACTION_GROUP_CLASS, SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { useRelations } from '../controller/useRelations.tsx'
import { AgentRequestArgumentDraft } from './AgentRequestArgumentDraft.tsx'

const button = `${SOFT_BUTTON_CLASS} px-3 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`
const secondary = `${SECONDARY_BUTTON_CLASS} px-3 py-2 text-[13px]`
const toolKey = (tool: AgentRequestReview['tools'][number]) => JSON.stringify([tool.connectionId, tool.connectionRevision, tool.tool.name, tool.schemaHash])
const literal = (value: unknown) => JSON.stringify(value, null, 2)

function Recovery({ id, onOpenRequest }: { id?: string; onOpenRequest: (id: string) => void }) {
  const { attempts } = useAgentRequestActions()
  return <>{attempts.filter(row => (!id || row.id === id) && row.state !== 'settled').map(attempt => <div key={attempt.id}
    role={attempt.error ? 'alert' : 'status'} className="space-y-2 border-l-2 border-accent pl-3 text-[13px] text-ink-soft">
    <p>{attempt.state === 'sending' ? 'Sending this exact decision…' : attempt.state === 'checking' ? 'Checking saved status…' : attempt.error ?? 'A previous request needs a read-only status check.'}</p>
    {!['sending', 'checking'].includes(attempt.state) && <div className={FORM_ACTION_GROUP_CLASS}>
      {attempt.state !== 'refused' && <button className={button} onClick={() => checkAgentRequest(attempt.id)}>Check saved status</button>}
      <button className={secondary} onClick={() => onOpenRequest(attempt.id)}>Open request</button>
      <button className={secondary} onClick={() => dismissAgentRequestAttempt(attempt.id)}>Dismiss notice</button>
    </div>}
    <p className="text-[12px]">Checking never resubmits work. Dismissing removes this recovery reminder; it does not cancel a request or undo an effect. Check history before sending a new request, which could duplicate saved work.</p>
  </div>)}</>
}
function CreateRequest() {
  const formId = useId(), options = useAgentRequestOptions(), state = useAgentRequestActions(), { navigate } = useRelations()
  const draft = state.draft('create')
  const held = state.creating || state.attempts.some(row => row.action?.kind === 'create' && !['settled', 'refused'].includes(row.state))
  const change = (field: string, value: string) => setAgentRequestDraft('create', { ...draft, [field]: value })
  const [error, setError] = useState<string | null>(null)
  const ready = options.status === 'success' && options.data?.sourceAgents.some(row => row.id === draft.fromAgentId) &&
    options.data.targetAgents.some(row => row.id === draft.toAgentId) && !!draft.task?.trim()
  const submit = () => {
    if (!ready || held) return
    if (new TextEncoder().encode(draft.task).length > AGENT_REQUEST_TASK_MAX_BYTES) { setError('Keep the request under 8 KB of text.'); return }
    setError(null)
    void sendAgentRequest({ fromAgentId: draft.fromAgentId, toAgentId: draft.toAgentId, task: draft.task })
      .catch(() => setError('Couldn’t prepare this request. Your draft is still here.'))
  }
  return <section className="space-y-3" aria-labelledby={`${formId}-title`}>
    <h2 id={`${formId}-title`} className="font-medium text-ink">Ask another Agent</h2>
    <p className="text-[13px] text-ink-soft">Describe the outcome you need. The other person chooses whether to act and what to share. Never include passwords or private connection credentials.</p>
    {options.error ? <ReadFailure onRetry={() => refreshAgentRequests()} /> : !options.data ? <p role="status">Loading available Agents…</p> : <>
      {!options.data.sourceAgents.length && <div className="space-y-2 text-[13px] text-ink-soft"><p>Create or fork an Agent while signed in to bind it to you. Existing shared or unbound Agents are not claimed automatically.</p><button className={secondary} onClick={() => navigate('agents')}>Open Agents</button></div>}
      {!options.data.targetAgents.length && <p className="text-[13px] text-ink-soft">No other person’s eligible Agent is visible yet. They can create an Agent and publish its definition, or use your shared workspace.</p>}
      <div className="grid gap-3 @lg:grid-cols-2">
        <div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-source`}>Your Agent</label><select id={`${formId}-source`} className={FORM_INPUT_CLASS} value={draft.fromAgentId ?? ''} disabled={held} onChange={event => change('fromAgentId', event.target.value)}><option value="">Choose your Agent</option>{options.data.sourceAgents.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></div>
        <div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-target`}>Receiving Agent</label><select id={`${formId}-target`} className={FORM_INPUT_CLASS} value={draft.toAgentId ?? ''} disabled={held} onChange={event => change('toAgentId', event.target.value)}><option value="">Choose another person’s Agent</option>{options.data.targetAgents.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></div>
      </div>
      <div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-task`}>Requested outcome</label><textarea id={`${formId}-task`} className={FORM_INPUT_CLASS} rows={3} maxLength={AGENT_REQUEST_TASK_MAX_BYTES} value={draft.task ?? ''} disabled={held} onChange={event => change('task', event.target.value)} /></div>
      {error && <p role="alert" className="text-[13px] text-danger-text">{error}</p>}
      <button className={button} disabled={!ready || held} onClick={submit}>{held ? 'Sending request…' : 'Send request'}</button>
    </>}
  </section>
}

function OwnerRun({ row, held }: { row: AgentRequestView; held: boolean }) {
  const formId = useId(), query = useAgentRequestReview(row.id, true), state = useAgentRequestActions(), draft = state.draft(row.id)
  const [reviewed, setReviewed] = useState<AgentRequestApproval | null>(null), [local, setLocal] = useState(false), [error, setError] = useState<string | null>(null)
  const chosen = query.data?.tools.find(tool => toolKey(tool) === draft.tool)
  const fresh = query.status === 'success' && query.data?.request.revision === row.revision && !query.data.blockedReason && row.argumentDraft?.status !== 'pending'
  const matches = !!reviewed && query.data?.tools.some(tool => tool.connectionId === reviewed.call.connectionId &&
    tool.connectionRevision === reviewed.call.connectionRevision && tool.tool.name === reviewed.call.toolName &&
    tool.schemaHash === reviewed.call.schemaHash && tool.transport === reviewed.transport)
  const prepare = () => {
    if (!chosen || !fresh || held) return
    try {
      const args: unknown = JSON.parse(draft.arguments ?? '{}')
      if (!args || typeof args !== 'object' || Array.isArray(args) || new TextEncoder().encode(literal(args)).length > 49_152) throw new Error()
      const call = { connectionId: chosen.connectionId, connectionRevision: chosen.connectionRevision, toolName: chosen.tool.name,
        schemaHash: chosen.schemaHash, arguments: args as AgentRequestApproval['call']['arguments'] }
      setReviewed(chosen.transport === 'stdio' ? { transport: 'stdio', localPrograms: true, call } : { transport: 'http', call })
      setLocal(false); setError(null)
    } catch { setError('Use a JSON object up to 48 KB for the tool arguments.') }
  }
  if (query.error) return <ReadFailure onRetry={() => refreshAgentRequests(row.id)} />
  if (!query.data) return <p role="status">Loading your private call review…</p>
  return <section className="space-y-3" aria-label="Owner call review">
    <h2 className="font-medium text-ink">Choose one call</h2>
    <p className="text-[13px] text-ink-soft">You choose the exact tool and review its arguments, with optional help from your Agent. Arguments and raw results are never shared with the requester; running never shares a reply.</p>
    {query.data.blockedReason && <p role="status" className="text-[13px] text-ink-soft">{query.data.blockedReason}</p>}
    {!reviewed ? <>
      <div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-tool`}>Inspected tool</label><select id={`${formId}-tool`} className={FORM_INPUT_CLASS} value={draft.tool ?? ''} disabled={held || !fresh}
        onChange={event => setAgentRequestDraft(row.id, { ...draft, tool: event.target.value })}><option value="">Choose an exact tool</option>{query.data.tools.map(tool => <option key={toolKey(tool)} value={toolKey(tool)}>{tool.connectionLabel} · {tool.tool.name} · {tool.transport === 'stdio' ? 'Local program' : 'HTTP service'}</option>)}</select></div>
      {chosen && <details className="text-[12px] text-ink-soft"><summary>Tool description and input schema</summary><p className="whitespace-pre-wrap break-words">{chosen.tool.description}</p><pre className="whitespace-pre-wrap break-words">{literal(chosen.tool.inputSchema)}</pre></details>}
      <AgentRequestArgumentDraft row={row} review={query.data} chosen={chosen} held={held || !fresh}
        onUse={argumentsJson => setAgentRequestDraft(row.id, { ...draft, arguments: argumentsJson })} />
      <div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-arguments`}>Arguments (JSON)</label><textarea id={`${formId}-arguments`} className={`${FORM_INPUT_CLASS} font-mono`} rows={5} value={draft.arguments ?? '{}'} disabled={held || !fresh} onChange={event => setAgentRequestDraft(row.id, { ...draft, arguments: event.target.value })} /></div>
      {error && <p role="alert" className="text-[13px] text-danger-text">{error}</p>}
      <button className={button} disabled={!chosen || !fresh || held} onClick={prepare}>Review call</button>
    </> : <div className="space-y-3 border-l-2 border-accent pl-3">
      <h3 className="font-medium text-ink">Run {reviewed.call.toolName} once?</h3>
      <p className="text-[13px] text-ink-soft">{query.data.tools.find(tool => tool.connectionId === reviewed.call.connectionId)?.connectionLabel} · {reviewed.transport === 'stdio' ? 'Local program' : 'HTTP service'}</p>
      <pre className="whitespace-pre-wrap break-words text-[12px] text-ink">{literal(reviewed.call.arguments)}</pre>
      <p className="text-[13px] text-ink-soft">This call may change an external system. Cancellation cannot undo its effects. Failed or uncertain work is never repeated automatically.</p>
      {reviewed.transport === 'stdio' && <CheckboxRow checked={local} disabled={held} onToggle={() => setLocal(!local)}><span className="text-[13px]">I understand this local program has normal OS access and may have startup effects, even if the tool is refused. Tool bounds are not a sandbox.</span></CheckboxRow>}
      {!fresh || !matches ? <p role="alert" className="text-[13px] text-danger-text">This review is stale. Go back and review the current tool.</p> : null}
      <div className={FORM_ACTION_GROUP_CLASS}><button className={button} disabled={held || !fresh || !matches || (reviewed.transport === 'stdio' && !local)} onClick={() => decideRequest(row.id, { action: 'run', expectedRevision: row.revision, approval: reviewed })}>Run once</button><button className={secondary} disabled={held} onClick={() => setReviewed(null)}>Back to arguments</button></div>
    </div>}
  </section>
}

function ShareReply({ row, held }: { row: AgentRequestView; held: boolean }) {
  const formId = useId(), state = useAgentRequestActions(), draft = state.draft(row.id)
  const [reviewed, setReviewed] = useState<{ reply: string; revision: number } | null>(null)
  const reply = draft.reply ?? ''
  const valid = !!reply.trim() && new TextEncoder().encode(reply).length <= AGENT_REQUEST_REPLY_MAX_BYTES
  const fresh = reviewed === null || reviewed.revision === row.revision
  return <section className="space-y-3" aria-label="Share reviewed reply"><h2 className="font-medium text-ink">Write a reply to share</h2>
    <p className="text-[13px] text-ink-soft">You can answer or ask for clarification without running a tool. Only the exact text you approve goes to the requester. Remove credentials, personal data and anything you do not intend to disclose.</p>
    {row.argumentDraft?.status === 'pending' && <p role="status" className="text-[13px] text-ink-soft">Wait for the private argument draft to settle before sharing, or cancel this request. No tool is running.</p>}
    {reviewed === null ? <><div className="space-y-1 text-[13px]"><label htmlFor={`${formId}-reply`}>Reply</label><textarea id={`${formId}-reply`} className={FORM_INPUT_CLASS} rows={4} value={reply} disabled={held} onChange={event => setAgentRequestDraft(row.id, { ...draft, reply: event.target.value })} /></div><button className={button} disabled={held || !valid} onClick={() => setReviewed({ reply, revision: row.revision })}>Review reply</button></> : <>
      <p className="whitespace-pre-wrap break-words text-[13px] text-ink">{reviewed.reply}</p>
      <p className="text-[13px] text-ink-soft">Share this text with the person behind {row.fromAgentLabel}? Sharing completes this request. This disclosure cannot be undone here.</p>
      {!fresh && <p role="alert" className="text-[13px] text-danger-text">This request changed after your review. Keep editing, then review the reply again.</p>}
      <div className={FORM_ACTION_GROUP_CLASS}><button className={button} disabled={held || !fresh} onClick={() => { if (!held && fresh) decideRequest(row.id, { action: 'share', expectedRevision: reviewed.revision, reply: reviewed.reply }) }}>Share reply</button><button className={secondary} disabled={held} onClick={() => setReviewed(null)}>Keep editing</button></div>
    </>}
  </section>
}

function RequestDetail({ id, onOpenRequest, onBack, backTo }: { id: string; onOpenRequest: (id: string) => void; onBack: () => void; backTo: NavLocation | null }) {
  const query = useAgentRequest(id), { attempts } = useAgentRequestActions(), row = query.data
  const [cancelReview, setCancelReview] = useState(false), [toolsOpen, setToolsOpen] = useState(false)
  const toolsId = useId()
  const held = attempts.some(attempt => attempt.id === id && !['settled', 'refused'].includes(attempt.state))
  useEffect(() => { if (row?.status !== 'running' && row?.argumentDraft?.status !== 'pending') return; const timer = setInterval(() => refreshAgentRequests(id), 5_000); return () => clearInterval(timer) }, [id, row?.status, row?.argumentDraft?.status])
  if (!row) return <ResourceUnavailablePage title="Agent request" state={resolveResourceUnavailable([query], { notFoundIsMissing: true })} message="This request is unavailable to this person." backTo={backTo} onBack={onBack} onRetry={() => refreshAgentRequests(id)} />
  const editable = !held && query.status === 'success'
  return <AtomicResourcePage data-agent-request={id}>
    <ResourcePageHeader title="Agent request" subtitle={`${row.fromAgentLabel} → ${row.toAgentLabel} · ${statusLabel(row)}`} />
    <div className="space-y-6">
      <Recovery id={id} onOpenRequest={onOpenRequest} />
      {query.error && <ReadFailure onRetry={() => refreshAgentRequests(id)} />}
      <section className="space-y-2"><h2 className="font-medium text-ink">Requested outcome</h2><p className="whitespace-pre-wrap break-words text-[13px] text-ink">{row.task}</p><p className="text-[12px] text-ink-faint">{new Date(row.createdAt).toLocaleString()} · {row.role === 'owner' ? 'Received' : 'Sent'}</p></section>
      {(!row.fromAgentAvailable || !row.toAgentAvailable) && <p className="text-[13px] text-ink-soft">An original Agent was removed. This private history is retained; it does not restore execution permission.</p>}
      {row.execution && <section className="space-y-2" aria-label="Private execution receipt"><h2 className="font-medium text-ink">Private execution receipt</h2><p className="text-[13px] text-ink-soft">{row.execution.status === 'pending' ? 'The call is still settling. A cancellation cannot undo its effects.' : row.execution.summary}</p>
        <details className="text-[12px] text-ink-soft"><summary>Exact call and raw result · visible only to you</summary><pre className="whitespace-pre-wrap break-words">{literal(row.execution)}</pre></details></section>}
      {row.role === 'owner' && row.argumentDraft && (row.status !== 'waiting' || !toolsOpen) && <section className="space-y-2 text-[13px] text-ink-soft" aria-label="Private argument draft receipt"><h2 className="font-medium text-ink">Private argument draft receipt</h2><p>Model draft: {row.argumentDraft.status}. This is not a tool-execution receipt or consent to share.</p><p className="break-words">{row.argumentDraft.binding.toolName} · {row.argumentDraft.binding.model}</p><details className="text-[12px]"><summary>Saved model draft · visible only to you</summary><pre className="whitespace-pre-wrap break-words">{literal(row.argumentDraft)}</pre></details></section>}
      {row.role === 'owner' && ['waiting', 'awaiting-reply'].includes(row.status) && <ShareReply key={id} row={row} held={!editable || row.argumentDraft?.status === 'pending'} />}
      {row.role === 'owner' && row.status === 'waiting' && <section className="space-y-3" aria-label="Optional tool use">
        <button className={secondary} aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen(!toolsOpen)}>{toolsOpen ? 'Hide tool options' : 'Use a tool…'}</button>
        <div id={toolsId}>{toolsOpen && <OwnerRun key={id} row={row} held={!editable} />}</div>
      </section>}
      {row.reply !== undefined && <section className="space-y-2" aria-label="Shared reply"><h2 className="font-medium text-ink">Shared reply</h2><p className="whitespace-pre-wrap break-words text-[13px] text-ink">{row.reply}</p></section>}
      {['waiting', 'running', 'awaiting-reply'].includes(row.status) && <div className="space-y-3">
        {cancelReview ? <><p className="text-[13px] text-ink-soft">Cancel this request and close sharing? An in-flight call may still finish and cannot be undone.</p><div className={FORM_ACTION_GROUP_CLASS}><button className={secondary} disabled={!editable} onClick={() => { decideRequest(id, { action: 'cancel', expectedRevision: row.revision }); setCancelReview(false) }}>Confirm cancellation</button><button className={secondary} onClick={() => setCancelReview(false)}>Keep request</button></div></> :
          <div className={FORM_ACTION_GROUP_CLASS}>{row.role === 'owner' && row.status === 'waiting' && <button className={secondary} disabled={!editable || row.argumentDraft?.status === 'pending'} title={row.argumentDraft?.status === 'pending' ? 'Cancel the request to stop a pending draft.' : undefined} onClick={() => decideRequest(id, { action: 'deny', expectedRevision: row.revision })}>Decline request</button>}<button className={secondary} disabled={!editable} onClick={() => setCancelReview(true)}>Cancel request</button></div>}
      </div>}
    </div>
  </AtomicResourcePage>
}
export function AgentRequestsPage({ requestId, onOpenRequest, onBack, backTo }: { requestId?: string | null; onOpenRequest: (id: string) => void; onBack: () => void; backTo: NavLocation | null }) {
  if (requestId) return <RequestDetail key={requestId} id={requestId} onOpenRequest={onOpenRequest} onBack={onBack} backTo={backTo} />
  return <CompositeResourcePage section="agents" sectionPage>
    <ResourcePageHeader title="Requests" subtitle="Private requests between two people’s Agents. Reply directly or optionally use a tool; sharing is always your decision." />
    <div className="space-y-6"><Recovery onOpenRequest={onOpenRequest} /><CreateRequest /><section className="space-y-3"><h2 className="font-medium text-ink">Request history</h2><AgentRequestsSummary onOpenRequest={onOpenRequest} /></section></div>
  </CompositeResourcePage>
}
