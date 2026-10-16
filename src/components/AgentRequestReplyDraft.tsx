import { useId, useState } from 'react'
import type { AgentRequestDraftModel, AgentRequestReplyDraftBinding, AgentRequestView } from '../../contract/agentRequests.ts'
import { AGENT_REQUEST_REPLY_NOTES_MAX_BYTES } from '../../contract/agentRequests.ts'
import { refreshAgentRequests, useAgentRequestReplyReview } from '../api/agentRequests.ts'
import { decideRequest, setAgentRequestDraft, useAgentRequestActions } from '../controller/agentRequestActions.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { namedReadRegionProps } from '../lib/dialog.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'

const button = `${SECONDARY_BUTTON_CLASS} px-3 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`

function bindingFor(model: AgentRequestDraftModel | undefined): AgentRequestReplyDraftBinding | undefined {
  if (!model) return undefined
  return { agentRevision: model.agentRevision, providerId: model.providerId, providerRevision: model.providerRevision,
    providerConnectionRevision: model.providerConnectionRevision, model: model.model }
}

/** Private one-shot reply advice. Receipt text never replaces the shared-reply editor automatically. */
export function AgentRequestReplyDraft({ row, held, onUse }: {
  row: AgentRequestView
  held: boolean
  onUse: (text: string) => void
}) {
  const id = useId(), state = useAgentRequestActions(), draft = state.draft(row.id)
  const [expanded, setExpanded] = useState(false), [confirmReplace, setConfirmReplace] = useState(false)
  const review = useAgentRequestReplyReview(row.id, expanded)
  const notes = draft.replyDraftNotes ?? ''
  const bytes = new TextEncoder().encode(notes).length
  const binding = bindingFor(review.data?.draftModel)
  const allowedStatus = ['waiting', 'awaiting-reply'].includes(row.status)
  const reviewCurrent = review.status === 'success' && review.data?.request.id === row.id &&
    review.data.request.revision === row.revision && allowedStatus && !review.data.blockedReason
  const saved = row.replyDraft
  const bindingCurrent = !!binding && !!saved && Object.keys(binding).every(key =>
    binding[key as keyof AgentRequestReplyDraftBinding] === saved.binding[key as keyof AgentRequestReplyDraftBinding])
  const canStart = reviewCurrent && !!binding && !saved && !held && row.argumentDraft?.status !== 'pending'
  const canUse = reviewCurrent && bindingCurrent && saved?.status === 'done' && !held && row.argumentDraft?.status !== 'pending'
  const changeNotes = (value: string) => setAgentRequestDraft(row.id, { ...draft, replyDraftNotes: value })

  return <section className="space-y-2 rounded-lg border border-line p-3 text-[13px] text-ink-soft [overflow-wrap:anywhere]" aria-label="Optional reply draft">
    <button className={button} aria-expanded={expanded} aria-controls={`${id}-content`} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Hide reply-draft option' : 'Draft a reply…'}
    </button>
    {!expanded && saved && <p role="status">Saved private reply draft: {saved.status}. Open to inspect it and check whether the current model binding still matches.</p>}
    <div id={`${id}-content`} hidden={!expanded} className="space-y-3">
      {expanded && <>
      {review.status === 'loading' && !review.data && <p role="status">Loading the private reply-draft review…</p>}
      {review.error && <div className="space-y-2"><p role="alert">Could not read the current Agent and model binding. No new reply draft was requested.</p>
        <button className={button} onClick={() => refreshAgentRequests(row.id)}>Retry current model review</button></div>}
      {review.status === 'success' && review.data && !saved && <>
        {review.data.draftModel ? <>
          <p>Provider: {review.data.draftModel.providerLabel} · Model: <code className="break-all">{review.data.draftModel.model}</code></p>
          <p>This sends only the request, Agent instructions and your notes to the selected model. It does not send conversation history, tool descriptions, schemas, tool results or connection credentials.</p>
          <p>Your workspace pays for model usage. One attempt per request; local token limits are not a billing cap. Drafting neither runs a tool nor shares a reply.</p>
          <div className="space-y-1"><label htmlFor={`${id}-notes`}>Notes for a reply draft</label>
            <textarea id={`${id}-notes`} className={`${FORM_INPUT_CLASS} min-h-20`} rows={3}
              value={notes} disabled={held || row.argumentDraft?.status === 'pending'} aria-describedby={`${id}-notes-help`}
              onChange={event => changeNotes(event.target.value)} />
            <p id={`${id}-notes-help`} className="text-[12px]">Optional. Sent once with this request and the Agent instructions. Maximum 8 KB of UTF-8 text.</p>
          </div>
          {bytes > AGENT_REQUEST_REPLY_NOTES_MAX_BYTES && <p role="alert">Keep notes under 8 KB of UTF-8 text.</p>}
          {row.argumentDraft?.status === 'pending' && <p role="status">Wait for the private argument draft to settle or cancel this request. No tool is running.</p>}
          {review.data.blockedReason && <p role="status">{review.data.blockedReason}</p>}
          <button className={button} disabled={!canStart || bytes > AGENT_REQUEST_REPLY_NOTES_MAX_BYTES}
            onClick={() => { if (binding && canStart && bytes <= AGENT_REQUEST_REPLY_NOTES_MAX_BYTES) decideRequest(row.id,
              { action: 'draft-reply', expectedRevision: row.revision, binding, notes }) }}>Draft reply</button>
        </> : <p role="status">Optional reply drafting needs a current configured endpoint model for this Agent. You can still write a reply yourself.</p>}
      </>}
      {saved && saved.status === 'pending' && <p role="status">Drafting a private reply… No tool is running. You can cancel the request; a model call already sent may still be charged. It will not be retried automatically.</p>}
      {saved && saved.status === 'done' && <>
        <p className="font-medium text-ink">Suggested reply · private to you</p>
        <p>Saved model: <code className="break-all">{saved.binding.model}</code></p>
        <pre {...namedReadRegionProps('Suggested reply', 'agent-request')} className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[13px] text-ink">{saved.text}</pre>
        {!reviewCurrent || !bindingCurrent ? <p role="status">The Agent or model binding changed, or this request is no longer replyable. This suggestion is retained as private history; refresh before using it.</p> : <>
          {confirmReplace ? <div role="alert" className="space-y-2"><p>Replace the editable Reply with this suggested text? Any text currently in Reply will be overwritten. The suggestion will not be shared until you review and share it separately.</p>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={!canUse} onClick={() => { if (canUse) { onUse(saved.text); setConfirmReplace(false) } }}>Replace with suggested reply</button>
              <button className={button} onClick={() => setConfirmReplace(false)}>Keep current reply</button></div></div> :
            <button className={button} disabled={!canUse} onClick={() => setConfirmReplace(true)}>Use reply draft</button>}
        </>}
      </>}
      {saved && (saved.status === 'failed' || saved.status === 'uncertain') && <p role="status">{saved.status === 'uncertain' ? 'The model outcome is uncertain.' : 'No usable reply draft was returned.'} This one attempt will not repeat automatically. Model usage may have been charged. Write your reply yourself or cancel the request.</p>}
      {review.status === 'success' && saved && !review.data?.draftModel && <p role="status">The configured model is no longer available. The saved suggestion remains private history and cannot be adopted.</p>}
      {review.error && saved && <p role="alert">Could not verify the current Agent and model binding. The saved suggestion is retained but cannot be adopted until the review succeeds.</p>}
      </>}
    </div>
  </section>
}
