import { useEffect, useId, useState } from 'react'
import type { McpFormPropertySchema } from '../../contract/mcpElicitation.ts'
import type { McpInputReview } from '../../contract/mcpInput.ts'
import { useMe } from '../api/hooks.ts'
import { useMcpInput } from '../api/mcpInputHook.ts'
import { invalidateMcpInput, type McpInputScope } from '../api/mcpInputCommands.ts'
import { ApiRequestError } from '../api/client.ts'
import { beginMcpInput } from '../controller/mcpInputMutations.ts'
import { updateMcpInputDraft, useMcpInputHeld } from '../controller/mcpInputState.ts'
import { emptyMcpInputDraft, mcpInputChoices, type McpInputFieldDraft, type McpInputFormDraft } from '../lib/mcpInputDraft.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { namedReadRegionProps } from '../lib/dialog.ts'
import { MCP_INPUT_READ_DISCLOSURE } from '../lib/mcpInputCopy.ts'
import { CheckboxRow } from './Checkbox.tsx'

export function McpInputReviewPanel({ sessionId, activityId, decisionId }: {
  sessionId: string; activityId: string; decisionId: string
}) {
  const identity = useMe().data
  const query = useMcpInput(sessionId, activityId, decisionId)
  const scope: McpInputScope = { sessionId, activityId, decisionId,
    sourceUserId: identity?.via === 'session' ? identity.user.id : null }
  const held = useMcpInputHeld(scope)
  if (!identity || query.status === 'idle' || query.status === 'loading') return <p role="status" className="mt-2 text-[12px] text-ink-soft">Checking private review access…</p>
  if (query.status === 'error') {
    const unavailable = query.error instanceof ApiRequestError && [401, 403, 404].includes(query.error.status)
    return <div role="alert" className="mt-2 text-[12px] text-ink-soft">
      <p>{unavailable ? 'Private review is unavailable to this account.' : `Couldn’t read the private review. ${MCP_INPUT_READ_DISCLOSURE}`}</p>
      {!unavailable && <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`}
        onClick={() => invalidateMcpInput(sessionId)}>Retry review</button>}
    </div>
  }
  if (held?.attempt && held.review) return <PrivateForm key={`${decisionId}:${held.review.round}`} scope={scope} review={held.review} />
  if (!query.data?.review) return <p role="status" data-mcp-input-private="unavailable" className="mt-2 text-[12px] text-ink-soft">
    {query.data?.activity.status === 'awaiting-input'
      ? 'Waiting for private input from the person who approved this call.'
      : held?.attempt ? 'Your response has a recovery notice above. Check its saved status before reviewing again.'
        : 'There is no pending private form for this call.'}
  </p>
  return <PrivateForm key={`${decisionId}:${query.data.review.round}`} scope={scope} review={query.data.review} />
}

function PrivateForm({ scope, review }: { scope: McpInputScope; review: McpInputReview }) {
  const held = useMcpInputHeld(scope)
  const draft = held?.round === review.round ? held.draft : emptyMcpInputDraft(review)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const id = useId()
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(review.expiresAt - Date.now(), 2_147_483_647)))
    return () => clearTimeout(timer)
  }, [review.expiresAt])
  const frozen = !!held?.attempt
  const expired = now >= review.expiresAt
  const disabled = frozen || !review.canContinue || expired
  const update = (requestId: string, form: McpInputFormDraft) => {
    setError(null)
    updateMcpInputDraft(scope, review, { ...draft, [requestId]: form })
  }
  const submit = (action: 'respond' | 'stop') => {
    try { beginMcpInput(scope, review, action, draft); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the form values before continuing.') }
  }
  return <form data-mcp-input-review data-mcp-input-round={review.round} className="mt-3 min-w-0 space-y-3 border-t border-line pt-3"
    onSubmit={(event) => { event.preventDefault(); if (!disabled) submit('respond') }}>
    <div className="space-y-1 text-[12px] leading-relaxed text-ink-soft">
      <h4 className="font-semibold text-ink">Private follow-up · round {review.round}</h4>
      <p className="break-words [overflow-wrap:anywhere]">{review.connectionLabel} · {review.toolName}</p>
      <p>The external server requested the forms below. Continue sends your reviewed choices to that server and may cause effects.</p>
      <p>Don’t enter passwords, API tokens or payment details. The forms and your answers are private to you in this app; the server’s final result may repeat answers in the shared conversation.</p>
      <p>Stop locally sends nothing further. It cannot undo earlier remote effects.</p>
    </div>
    {(!review.canContinue || expired) && <p role="alert" className="text-[12px] text-warn-text">
      {expired ? 'This review expired. You can stop locally; it cannot be continued.' : review.refusal ?? 'This call can no longer be continued. You can stop locally.'}
    </p>}
    <div {...namedReadRegionProps('Private MCP form requests', 'mcp-input')} className="max-h-96 min-w-0 space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-3">
      {Object.entries(review.inputRequests).map(([requestId, request], requestIndex) => {
        const schema = request.params.requestedSchema
        const form = draft[requestId] ?? { action: 'accept', fields: {} }
        const prefix = `${id}-${requestIndex}`
        return <fieldset key={requestId} disabled={frozen} className="min-w-0 space-y-3">
          <legend className="max-w-full break-words text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">{schema.title ?? `Form ${requestIndex + 1}`}</legend>
          <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">{request.params.message}</p>
          {schema.description && <p className="break-words text-[12px] text-ink-soft [overflow-wrap:anywhere]">{schema.description}</p>}
          <label className="block space-y-1 text-[12px] text-ink">
            <span>Response for form {requestIndex + 1}</span>
            <select className={`${FORM_INPUT_CLASS} w-full min-w-0`} value={form.action}
              onChange={(event) => update(requestId, { ...form, action: event.target.value as McpInputFormDraft['action'] })}>
              <option value="accept">Provide answers</option><option value="decline">Decline this form</option><option value="cancel">Cancel this form</option>
            </select>
          </label>
          {form.action !== 'accept' && <p className="text-[12px] text-ink-soft">Continue will send this choice to the server. This is not a local stop or a guarantee that remote work is cancelled.</p>}
          {form.action === 'accept' && Object.entries(schema.properties).map(([name, property], fieldIndex) =>
            <McpInputField key={name} id={`${prefix}-${fieldIndex}`} name={name} schema={property} required={schema.required?.includes(name) ?? false}
              value={Object.hasOwn(form.fields, name) ? form.fields[name] : undefined} disabled={frozen}
              onChange={(value) => update(requestId, { ...form, fields: value === undefined
                ? Object.fromEntries(Object.entries(form.fields).filter(([key]) => key !== name))
                : { ...form.fields, [name]: value } })} />)}
        </fieldset>
      })}
    </div>
    {error && <p role="alert" className="text-[12px] text-danger-text">{error}</p>}
    {frozen && <p role="status" className="text-[12px] text-ink-soft">This reviewed response is held. Use Check status or Review latest in the recovery notice above; neither sends it again.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={disabled} title={disabled ? 'Review is held, expired, or no longer authorized.' : undefined}
        className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:opacity-50`}>Continue with responses</button>
      <button type="button" disabled={frozen} onClick={() => submit('stop')}
        className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:opacity-50`}>Stop locally</button>
    </div>
  </form>
}

function McpInputField({ id, name, schema, required, value, disabled, onChange }: {
  id: string; name: string; schema: McpFormPropertySchema; required: boolean; value?: McpInputFieldDraft;
  disabled: boolean; onChange: (value: McpInputFieldDraft | undefined) => void
}) {
  const label = `${schema.title ?? name}${required ? ' (required)' : ' (optional)'}`
  const choices = mcpInputChoices(schema)
  const description = schema.description ? `${id}-description` : undefined
  const fieldClass = `${FORM_INPUT_CLASS} block w-full min-w-0`
  const common = { id, disabled, 'aria-required': required, 'aria-describedby': description }
  return <div className="min-w-0 space-y-1 text-[12px] text-ink">
    {schema.type === 'array' ? <fieldset className="min-w-0 space-y-2" disabled={disabled} aria-describedby={description}>
      <legend className="break-words [overflow-wrap:anywhere]">{label}</legend>
      {(choices ?? []).map((choice) => <CheckboxRow key={choice.value} disabled={disabled}
        checked={Array.isArray(value) && value.includes(choice.value)} onToggle={() => {
          const values = Array.isArray(value) ? value : []
          onChange(values.includes(choice.value) ? values.filter((item) => item !== choice.value) : [...values, choice.value])
        }}><span className="break-words [overflow-wrap:anywhere]">{choice.label}</span></CheckboxRow>)}
      <p className="text-[11px] text-ink-soft">Choose {schema.minItems ?? 0}–{schema.maxItems ?? choices?.length ?? 0} values.</p>
      {(schema.minItems ?? 0) === 0 && <button type="button" className="underline underline-offset-2" disabled={disabled} onClick={() => onChange([])}>Use an empty selection</button>}
    </fieldset> : <>
      <label htmlFor={id} className="block break-words [overflow-wrap:anywhere]">{label}</label>
      {schema.type === 'boolean' ? <select {...common} className={fieldClass} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
      </select> : choices ? <select {...common} className={fieldClass}
        value={value === undefined ? '' : String(choices.findIndex((choice) => choice.value === value))}
        onChange={(event) => { const choice = choices[Number(event.target.value)]; if (event.target.value !== '' && choice) onChange(choice.value) }}>
        <option value="" disabled>Choose…</option>{choices.map((choice, index) => <option key={choice.value} value={index}>{choice.label || '(Empty text)'}</option>)}
      </select> : schema.type === 'number' || schema.type === 'integer'
        ? <input {...common} className={fieldClass} type="number" step={schema.type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum}
          value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
        : schema.type === 'string' ? <input {...common} className={fieldClass} type={schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : schema.format === 'date' ? 'date' : 'text'}
          autoComplete="off" placeholder={schema.format === 'date-time' ? 'YYYY-MM-DDTHH:mm:ssZ' : undefined}
          value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} /> : null}
      {schema.type === 'string' && !choices && !schema.format && (schema.minLength ?? 0) === 0 &&
        <button type="button" className="underline underline-offset-2" disabled={disabled} onClick={() => onChange('')}>Use empty text</button>}
    </>}
    {schema.description && <p id={description} className="break-words text-ink-soft [overflow-wrap:anywhere]">{schema.description}</p>}
    {schema.default !== undefined && <p className="break-words text-[11px] text-ink-soft [overflow-wrap:anywhere]">Server suggestion (not filled): {JSON.stringify(schema.default)}</p>}
    {!required && value !== undefined && <button type="button" disabled={disabled} className="underline underline-offset-2" onClick={() => onChange(undefined)}>Omit this optional answer</button>}
  </div>
}
