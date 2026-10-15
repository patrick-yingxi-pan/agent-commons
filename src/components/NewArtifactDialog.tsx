import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import type { Project } from '../data/cowork'
import {
  MAX_AUTHORED_DOCUMENT_SOURCE_CHARS,
  authoredArtifact,
  normalizeArtifactName,
  type CreateArtifactRequest,
  type StructuredArtifactBody,
} from '../../contract/index.ts'
import { useMe } from '../api/hooks'
import { accountGeneration } from '../api/account.ts'
import { enqueueArtifactCreation, heldArtifactCreation, useArtifactCreationStatus, type ArtifactCreationResult } from '../controller/artifactCreationMutations'
import { ArtifactDocumentImport } from './ArtifactDocumentImport.tsx'
import { ArtifactPresentationImport } from './ArtifactPresentationImport.tsx'
import { ArtifactSheetImport } from './ArtifactSheetImport.tsx'
import { StructuredArtifactFields } from './StructuredArtifactEditor'
import { useArtifactDocumentImport } from '../lib/useArtifactDocumentImport.ts'
import { useArtifactPresentationImport } from '../lib/useArtifactPresentationImport.ts'
import { useArtifactSheetImport } from '../lib/useArtifactSheetImport.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { FormDialog, FormField } from './FormDialog.tsx'
import { KIND_LABEL } from './artifactPreview'
import type { LocalStructuredImport } from '../lib/localPreviewStructuredImport.ts'
import type { ArtifactFileImportSeed } from '../lib/useArtifactFileImport.ts'

export function NewArtifactDialog({
  projects,
  onCreated,
  onClose,
  initialDocument,
  initialStructured,
  initialImage,
}: {
  projects: Project[]
  onCreated: (id: string) => void
  onClose: () => void
  initialDocument?: { name: string; text: string; disclosure?: string; sourceName: string; generation: number }
  initialStructured?: LocalStructuredImport & { sourceName: string; generation: number }
  initialImage?: ArtifactFileImportSeed & { sourceName: string }
}) {
  const mutation = useArtifactCreationStatus()
  const held = heldArtifactCreation()
  const identity = useMe().data
  const [structuredSource] = useState(() => !held && initialStructured?.generation === accountGeneration() ? initialStructured : null)
  const [imageSource] = useState(() => !held && initialImage?.generation === accountGeneration() ? initialImage : null)
  const [initial] = useState(() => held?.intent.request ?? (initialDocument && initialDocument.generation === accountGeneration()
    ? { name: initialDocument.name, kind: 'doc' as const, body: initialDocument.text, projectId: null } : undefined))
  const [generation] = useState(accountGeneration)
  const [sourceDisclosure] = useState(() => held ? null : initialDocument)
  const [draftName, setName] = useState(initial?.name ?? '')
  const [draftKind, setKind] = useState<CreateArtifactRequest['kind']>(initial?.kind ?? structuredSource?.kind ?? 'doc')
  const [draftBody, setBody] = useState(typeof initial?.body === 'string' ? initial.body : '')
  const [draftSheet, setSheet] = useState<StructuredArtifactBody>(initial?.kind === 'sheet' && typeof initial.body !== 'string' ? initial.body : { type: 'sheet', columns: [''], rows: [['']] })
  const [draftSlides, setSlides] = useState<StructuredArtifactBody>(initial?.kind === 'slide' && typeof initial.body !== 'string' ? initial.body : { type: 'slides', slides: [{ title: '', bullets: [] }] })
  const [pendingSheetRenames, setPendingSheetRenames] = useState<string[]>([])
  const [draftProjectId, setProjectId] = useState<string | null>(initial?.projectId ?? null)
  // A second open pane sees the actual held request, not its unrelated local
  // draft wearing a false Creating label. Unsubmitted format drafts stay local.
  const heldRequest = held?.intent.request
  const name = heldRequest?.name ?? draftName
  const kind = heldRequest?.kind ?? draftKind
  const body = typeof heldRequest?.body === 'string' ? heldRequest.body : draftBody
  const sheet = heldRequest?.kind === 'sheet' && typeof heldRequest.body !== 'string' ? heldRequest.body : draftSheet
  const slides = heldRequest?.kind === 'slide' && typeof heldRequest.body !== 'string' ? heldRequest.body : draftSlides
  const projectId = heldRequest ? heldRequest.projectId ?? null : draftProjectId
  const [error, setError] = useState<string | null>(null)
  const tenantId = identity?.tenant.id
  const busy = held !== null
  const documentImport = useArtifactDocumentImport(draftKind === 'doc' && !busy, imageSource ?? undefined)
  const presentationImport = useArtifactPresentationImport(draftKind === 'slide' && !busy, structuredSource?.kind === 'slide' ? structuredSource : undefined)
  const sheetImport = useArtifactSheetImport(draftKind === 'sheet' && !busy, structuredSource?.kind === 'sheet' ? structuredSource : undefined)
  const documentBodyId = useId()
  const documentBodyRef = useRef<HTMLTextAreaElement>(null)
  const structuredFieldsRef = useRef<HTMLFieldSetElement>(null)
  const importedSheetFocusPending = useRef(false)
  useLayoutEffect(() => {
    if (!importedSheetFocusPending.current) return
    importedSheetFocusPending.current = false
    structuredFieldsRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Sheet column 1"]')?.focus()
  }, [sheet])
  const waitingForRecovery = busy && !!mutation.error
  const mounted = useRef(false)
  const followed = useRef<Promise<ArtifactCreationResult> | null>(null)
  const createdCallback = useRef(onCreated)
  createdCallback.current = onCreated
  const follow = (result: Promise<ArtifactCreationResult>) => {
    followed.current = result
    void result.then((settled) => {
      if (!mounted.current || followed.current !== result) return
      followed.current = null
      if (settled.outcome === 'applied') createdCallback.current(settled.artifactId)
      else setError('Creation was not completed. Your draft is ready to review.')
    }, () => {
      if (mounted.current && followed.current === result) {
        followed.current = null
        setError('Creation could not start. Your draft is still here; try again. If this persists, copy your draft before reloading.')
      }
    })
  }
  useEffect(() => {
    mounted.current = true
    const pending = heldArtifactCreation()
    if (pending) follow(pending.result)
    return () => { mounted.current = false }
  }, [])
  const helpId = useId()
  const close = busy ? () => {} : onClose
  const normalizedName = normalizeArtifactName(name)
  const authored = normalizedName && authoredArtifact(normalizedName, kind, kind === 'doc' ? body : kind === 'sheet' ? sheet : slides)
  const canFileProject = projectId === null || projects.some((project) => project.id === projectId && project.own === true)
  const canCreate = !!authored && !!tenantId && canFileProject && !busy && !documentImport.reviewing && !presentationImport.reviewing && !sheetImport.reviewing && !(kind === 'sheet' && pendingSheetRenames.length > 0) && (kind !== 'doc' || body.length <= MAX_AUTHORED_DOCUMENT_SOURCE_CHARS)
  const submit = () => {
    if (generation === accountGeneration() && canCreate && authored && normalizedName && tenantId) {
      setError(null)
      follow(enqueueArtifactCreation({ tenantId, sourceUserId: identity?.via === 'session' ? identity.user.id : null, request: { name: normalizedName, kind, body: authored.draftBody, projectId } }))
    }
  }

  return (
    <FormDialog
      title="New artifact"
      icon={<FileText size={18} className="text-cap-workspace" />}
      submitLabel={waitingForRecovery ? 'Waiting for recovery…' : busy ? 'Creating…' : `Create ${KIND_LABEL[kind].toLowerCase()}`}
      submitIcon={<Plus size={15} />}
      canSubmit={canCreate}
      onSubmit={submit}
      onClose={close}
      busy={busy}
      isolateEscape={initialDocument !== undefined || initialStructured !== undefined || initialImage !== undefined}
      error={error}
    >
      {sourceDisclosure && !heldRequest && <div data-local-document-draft className="space-y-1 break-words [overflow-wrap:anywhere] text-[12px] leading-relaxed text-ink-soft">
        <p>Started from reviewed text in {sourceDisclosure.sourceName}. This is an independent editable draft, not a live file. Create saves the edited content under your account; it does not change the source or share the document.</p>
        {sourceDisclosure.disclosure && <p>{sourceDisclosure.disclosure}</p>}
      </div>}
      {structuredSource && !heldRequest && <div data-local-structured-draft className="space-y-1 break-words [overflow-wrap:anywhere] text-[12px] leading-relaxed text-ink-soft">
        <p>Review the captured structure from {structuredSource.sourceName}. Use copies the reviewed values into an independent editable draft. Create saves only your edited content; it does not reread or change the source or share the artifact.</p>
      </div>}
      {imageSource && !heldRequest && <div data-local-image-draft className="space-y-1 break-words [overflow-wrap:anywhere] text-[12px] leading-relaxed text-ink-soft">
        <p>Extract text from the captured image preview of {imageSource.sourceName} on this Mac. Review recognition errors, then choose Use imported text to start an editable draft. Create saves only your edited text; it does not reread or change the source, save the image, or share the document.</p>
      </div>}
      <FormField label="Name">
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'doc' ? 'e.g. launch-brief.md' : kind === 'sheet' ? 'e.g. launch-metrics.xlsx' : 'e.g. launch-review.pptx'}
          aria-invalid={name.length > 0 && !normalizedName}
          className={FORM_INPUT_CLASS}
        />
        {name.length > 0 && !normalizedName && <span role="alert" className="mt-1 block text-[11px] text-removed">Use 1–240 characters without control characters.</span>}
      </FormField>
      <FormField label="Format">
        <select value={kind} disabled={busy} onChange={(event) => {
          const value = event.target.value
          if (value === 'doc' || value === 'sheet' || value === 'slide') {
            documentImport.discard()
            presentationImport.discard()
            sheetImport.discard()
            setKind(value)
          }
        }} className={FORM_INPUT_CLASS}>
          <option value="doc">Document</option>
          <option value="sheet">Sheet</option>
          <option value="slide">Slides</option>
        </select>
      </FormField>
      {kind === 'sheet' && <ArtifactSheetImport intake={sheetImport}
        hasContent={sheet.type === 'workbook' || (sheet.type === 'sheet' && (sheet.columns.length > 1 || sheet.rows.length > 1 || sheet.columns.some(Boolean) || sheet.rows.some((row) => row.some(Boolean)) || !!sheet.note))}
        disabled={busy} onUse={() => sheetImport.accept((candidate) => {
          importedSheetFocusPending.current = true
          setSheet(candidate.body)
          setName((current) => current.trim() ? current : candidate.name)
        })} />}
      {kind === 'slide' && <ArtifactPresentationImport intake={presentationImport}
        hasContent={slides.type === 'slides' && (slides.slides.length > 1 || slides.slides.some((slide) => slide.title.length > 0 || slide.bullets.length > 0))}
        disabled={busy} onUse={() => presentationImport.accept((candidate) => {
          setSlides(candidate.body)
          setName((current) => current.trim() ? current : candidate.name)
          structuredFieldsRef.current?.querySelector('textarea')?.focus()
        })} />}
      {kind === 'doc' ? <>
      <ArtifactDocumentImport intake={documentImport} hasContent={body.length > 0} disabled={busy} onUse={() => documentImport.accept((candidate) => {
        setBody(candidate.text)
        setName((current) => current.trim() ? current : candidate.name)
        documentBodyRef.current?.focus()
      })} />
      <FormField label="Content" controlId={documentBodyId}>
        <textarea
          id={documentBodyId}
          ref={documentBodyRef}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_AUTHORED_DOCUMENT_SOURCE_CHARS}
          aria-describedby={helpId}
          rows={9}
          placeholder="Write the document. Separate paragraphs with a blank line."
          className={`${FORM_INPUT_CLASS} resize-y leading-relaxed`}
        />
        <span id={helpId} className="mt-1 block text-[11px] text-ink-faint">
          Blank lines become independently editable paragraphs. The index synopsis is derived from this content. About 20,000
          characters maximum. Whitespace within each paragraph is normalized when saved.
        </span>
      </FormField></> : <fieldset ref={structuredFieldsRef} className="min-w-0 space-y-2" aria-describedby={helpId}>
        <legend className="mb-1.5 text-[12px] font-medium text-ink-soft">Content</legend>
        <p id={helpId} className="text-[11px] text-ink-faint">
          {kind === 'sheet' ? "A1 is the first data cell under the column headings. Cells are Text by default; Formula supports numbers and A1 references within this workbook, including another worksheet (Detail!A1 or 'Detail tab'!A1), + - * /, parentheses, and SUM ranges. Imports and pastes stay literal. XLSX downloads contain calculated values and errors, not formulas." : 'Give each slide a title, then add optional bullets.'}
          {' '}Up to 20,000 characters across this content.
        </p>
        <StructuredArtifactFields body={kind === 'sheet' ? sheet : slides} onChange={kind === 'sheet' ? setSheet : setSlides} disabled={busy} onPendingRenameChange={kind === 'sheet' ? setPendingSheetRenames : undefined} />
        {kind === 'sheet' && pendingSheetRenames.length > 0 && <p role="status" data-pending-sheet-renames className="break-words [overflow-wrap:anywhere] text-[11px] text-ink-soft">
          Finish or cancel worksheet rename{pendingSheetRenames.length === 1 ? '' : 's'} for {pendingSheetRenames.join(', ')} before creating this sheet.
        </p>}
        {normalizedName && !authored && <p role="status" className="text-[11px] text-ink-faint">{kind === 'sheet' ? 'Review required labels and worksheet names. Each cell or formula source must be at most 2,000 characters and the whole sheet or workbook at most 20,000; structural edits can expand formula references past these limits.' : 'Complete the required labels and keep the content within its size limits to create.'}</p>}
      </fieldset>}
      <FormField label="Project" optional>
        <select
          value={projectId ?? ''}
          disabled={busy}
          onChange={(e) => setProjectId(e.target.value || null)}
          className={FORM_INPUT_CLASS}
        >
          <option value="">No project</option>
          {!canFileProject && <option value={projectId ?? ''} disabled>Previously selected project (unavailable)</option>}
          {projects.filter((project) => project.own === true).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FormField>
    </FormDialog>
  )
}
