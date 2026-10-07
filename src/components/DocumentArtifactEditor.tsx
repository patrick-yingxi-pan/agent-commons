import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Plus, Save, X } from 'lucide-react'
import {
  MAX_AUTHORED_DOCUMENT_BLOCKS,
  parseEditableArtifactBody,
  type DocBlock,
  type DocumentEditBody,
} from '../../contract/index.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'

type Props = {
  body: DocumentEditBody
  onChange: (body: DocumentEditBody) => void
  latestBody?: DocumentEditBody
  onSave: () => void
  onCancel: () => void
  saving?: boolean
  error?: string | null
  showLatest?: boolean
}

const buttonClass = INLINE_ACTION_CLASS
const blockKinds = ['heading', 'paragraph', 'bullet list', 'code block', 'email header'] as const
type NewBlockKind = typeof blockKinds[number]

function createBlock(kind: NewBlockKind): DocBlock & { id: string } {
  const id = `block-${crypto.randomUUID()}`
  switch (kind) {
    case 'heading': return { id, h: '' }
    case 'paragraph': return { id, p: '' }
    case 'bullet list': return { id, ul: [''] }
    case 'code block': return { id, code: [''] }
    case 'email header': return { id, email: { to: '', subject: '' } }
  }
}

/** Full document replacement editor. Existing block identity and kind survive
 * text edits and reordering; only insertion mints a new stable block ID. */
export function DocumentArtifactEditor({ body, onChange, latestBody, onSave, onCancel, saving = false, error, showLatest = false }: Props) {
  const valid = parseEditableArtifactBody(body) !== undefined
  const [insertAt, setInsertAt] = useState(body.blocks.length)
  const blocks = body.blocks
  const boundedInsertAt = Math.min(Math.max(insertAt, 0), blocks.length)
  const updateBody = (next: DocumentEditBody) => {
    setInsertAt(Math.min(boundedInsertAt, next.blocks.length))
    onChange(next)
  }
  const updateBlock = (index: number, next: DocBlock & { id: string }) => {
    updateBody({ ...body, blocks: blocks.map((block, i) => i === index ? next : block) })
  }
  const insert = (kind: NewBlockKind) => {
    const next = [...blocks]
    next.splice(boundedInsertAt, 0, createBlock(kind))
    updateBody({ ...body, blocks: next })
    setInsertAt(Math.min(boundedInsertAt + 1, next.length))
  }
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= blocks.length) return
    const next = [...blocks]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    updateBody({ ...body, blocks: next })
  }
  const remove = (index: number) => {
    updateBody({ ...body, blocks: blocks.filter((_, i) => i !== index) })
    setInsertAt(Math.min(boundedInsertAt, blocks.length - 1, index))
  }

  return <div className="@container min-w-0 space-y-3" data-document-artifact-editor>
    <label className="block text-[11px] text-ink-soft">Document title
      <input aria-label="Document title" className={`${FORM_INPUT_CLASS} mt-1 w-full`} value={body.title} disabled={saving}
        onChange={event => updateBody({ ...body, title: event.target.value })} />
    </label>

    <div className="space-y-2" aria-label="Document blocks">
      {blocks.map((block, index) => <DocumentBlockEditor key={block.id} block={block} index={index} count={blocks.length} disabled={saving}
        onChange={next => updateBlock(index, next)} onMove={delta => move(index, delta)} onRemove={() => remove(index)} />)}
      {!blocks.length && <p className="text-[12px] text-ink-faint">No blocks yet. Insert a block below to continue.</p>}
    </div>

    <section className="min-w-0 space-y-1.5 rounded-lg border border-line bg-panel-2/30 p-2.5" aria-label="Insert document block">
      <label className="block text-[11px] text-ink-soft">Insert position
        <select aria-label="Insert position" className={`${FORM_INPUT_CLASS} mt-1 w-full`} value={boundedInsertAt} disabled={saving}
          onChange={event => setInsertAt(Number(event.target.value))}>
          {blocks.map((block, index) => <option key={block.id} value={index}>Before block {index + 1}</option>)}
          <option value={blocks.length}>At end</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {blockKinds.map(kind => <button key={kind} type="button" data-inline-action className={buttonClass}
          disabled={saving || blocks.length >= MAX_AUTHORED_DOCUMENT_BLOCKS} onClick={() => insert(kind)}>
          <Plus size={12} /> Add {kind}
        </button>)}
      </div>
    </section>

    <p className="text-[11px] leading-relaxed text-ink-faint">Up to 100 blocks, a 240-character title, 2,000 characters per text field, and 20,000 characters of block content total. After saving, discussions on deleted blocks are marked “original block deleted.”</p>
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
      <button type="button" data-inline-action className={buttonClass} disabled={saving || !valid} onClick={onSave}>
        <Save size={13} /> {saving ? 'Saving…' : 'Save changes'}
      </button>
      <button type="button" data-inline-action className={buttonClass} disabled={saving} onClick={onCancel}>
        <X size={13} /> Cancel
      </button>
    </div>
    {error && <p className="text-[11px] text-danger-text" role="status">{error}</p>}
    {!valid && <p className="text-[11px] text-danger-text" role="alert">Review the document title and block values. The complete draft must fit the authoring limits before saving.</p>}
    {showLatest && latestBody && <div className="min-w-0 space-y-2 rounded-lg border border-line bg-panel-2/40 p-2.5" role="status">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Latest saved version</div>
      <DocumentBodyLiteral body={latestBody} />
      <p className="text-[11px] text-ink-faint">Retry replaces the entire saved document with your held draft.</p>
    </div>}
  </div>
}

function DocumentBlockEditor({ block, index, count, disabled, onChange, onMove, onRemove }: {
  block: DocBlock & { id: string }
  index: number
  count: number
  disabled: boolean
  onChange: (block: DocBlock & { id: string }) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const controls = <div className="flex flex-wrap items-center gap-1.5">
    <span className="mr-auto text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Block {index + 1} · {blockLabel(block)}</span>
    <button type="button" aria-label={`Move block ${index + 1} up`} data-inline-action className={buttonClass} disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp size={12} /> Move up</button>
    <button type="button" aria-label={`Move block ${index + 1} down`} data-inline-action className={buttonClass} disabled={disabled || index === count - 1} onClick={() => onMove(1)}><ArrowDown size={12} /> Move down</button>
    <button type="button" aria-label={`Delete block ${index + 1}`} data-inline-action className={buttonClass} disabled={disabled} onClick={onRemove}><Minus size={12} /> Delete block</button>
  </div>
  const fieldClass = `${FORM_INPUT_CLASS} min-w-0 w-full resize-y`
  const label = (name: string) => `Block ${index + 1} ${name}`
  let fields
  if ('h' in block) fields = <textarea aria-label={label('heading')} className={fieldClass} rows={2} disabled={disabled} value={block.h}
    onChange={event => onChange({ id: block.id, h: event.target.value })} />
  else if ('p' in block) fields = <textarea aria-label={label('paragraph')} className={fieldClass} rows={3} disabled={disabled} value={block.p}
    onChange={event => onChange({ id: block.id, p: event.target.value })} />
  else if ('ul' in block) fields = <div className="space-y-1.5">
    {block.ul.map((bullet, bulletIndex) => <div key={bulletIndex} className="flex min-w-0 items-start gap-1.5">
      <textarea aria-label={label(`bullet ${bulletIndex + 1}`)} className={`${fieldClass} flex-1`} rows={2} disabled={disabled} value={bullet}
        onChange={event => onChange({ id: block.id, ul: block.ul.map((item, i) => i === bulletIndex ? event.target.value : item) })} />
      <button type="button" aria-label={`Remove block ${index + 1} bullet ${bulletIndex + 1}`} data-inline-action className={buttonClass} disabled={disabled}
        onClick={() => onChange({ id: block.id, ul: block.ul.filter((_, i) => i !== bulletIndex) })}><Minus size={12} /> Remove</button>
    </div>)}
    <button type="button" data-inline-action className={buttonClass} disabled={disabled || block.ul.length >= MAX_AUTHORED_DOCUMENT_BLOCKS}
      onClick={() => onChange({ id: block.id, ul: [...block.ul, ''] })}><Plus size={12} /> Add bullet to block {index + 1}</button>
  </div>
  else if ('code' in block) fields = <div className="space-y-1.5">
    {block.code.map((line, lineIndex) => <div key={lineIndex} className="flex min-w-0 items-start gap-1.5">
      <textarea aria-label={label(`code line ${lineIndex + 1}`)} className={`${fieldClass} flex-1 font-mono`} rows={2} disabled={disabled} value={line}
        onChange={event => onChange({ id: block.id, code: block.code.map((item, i) => i === lineIndex ? event.target.value : item) })} />
      <button type="button" aria-label={`Remove block ${index + 1} code line ${lineIndex + 1}`} data-inline-action className={buttonClass} disabled={disabled}
        onClick={() => onChange({ id: block.id, code: block.code.filter((_, i) => i !== lineIndex) })}><Minus size={12} /> Remove</button>
    </div>)}
    <button type="button" data-inline-action className={buttonClass} disabled={disabled || block.code.length >= MAX_AUTHORED_DOCUMENT_BLOCKS}
      onClick={() => onChange({ id: block.id, code: [...block.code, ''] })}><Plus size={12} /> Add code line to block {index + 1}</button>
  </div>
  else fields = <div className="grid min-w-0 gap-2 @sm:grid-cols-2">
    <label className="min-w-0 text-[11px] text-ink-soft">To<input aria-label={label('email recipient')} className={`${fieldClass} mt-1`} value={block.email.to} disabled={disabled}
      onChange={event => onChange({ id: block.id, email: { ...block.email, to: event.target.value } })} /></label>
    <label className="min-w-0 text-[11px] text-ink-soft">Subject<input aria-label={label('email subject')} className={`${fieldClass} mt-1`} value={block.email.subject} disabled={disabled}
      onChange={event => onChange({ id: block.id, email: { ...block.email, subject: event.target.value } })} /></label>
  </div>
  return <article role="group" aria-label={`Document block ${index + 1} ${blockLabel(block)}`}
    className="min-w-0 space-y-2 rounded-lg border border-line p-2.5" data-doc-block-id={block.id} data-document-block-editor>
    {controls}{fields}
  </article>
}

function blockLabel(block: DocBlock): string {
  if ('h' in block) return 'heading'
  if ('p' in block) return 'paragraph'
  if ('ul' in block) return 'bullet list'
  if ('code' in block) return 'code block'
  return 'email header'
}

/** Conflict details stay local and literal; importing artifactPreview here
 * would create a cycle and risk mixing saved values with the held draft. */
export function DocumentBodyLiteral({ body }: { body: DocumentEditBody }) {
  return <div className="min-w-0 space-y-2" data-latest-document-body>
    <h3 className="whitespace-pre-wrap break-words font-semibold [overflow-wrap:anywhere]">{body.title}</h3>
    {body.blocks.map((block, index) => <div key={block.id} className="min-w-0 break-words text-[12px] [overflow-wrap:anywhere]" data-latest-document-block={block.id}>
      {'h' in block ? <div className="whitespace-pre-wrap font-semibold">{block.h}</div>
        : 'p' in block ? <p className="whitespace-pre-wrap">{block.p}</p>
          : 'ul' in block ? <ul className="list-disc pl-5">{block.ul.map((line, lineIndex) => <li key={lineIndex} className="whitespace-pre-wrap text-[12px]">{line}</li>)}</ul>
            : 'code' in block ? <pre className="whitespace-pre-wrap font-mono text-[12px]">{block.code.join('\n')}</pre>
              : <p className="whitespace-pre-wrap">To: {block.email.to}<br />Subject: {block.email.subject}</p>}
    </div>)}
  </div>
}
