import { isDocBlockId, parseStructuredArtifactEdit, type UpdateArtifactContentRequest } from '../../contract/index.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { store } from '../store/index.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'

/** One owner-only content door. Numeric prose edits retain guarded legacy
 * compatibility; stable-ID prose and complete-body replacements require CAS. */
export async function updateArtifactContent({ req, res, params, body }: Ctx): Promise<void> {
  const tenantId = store.identity(req.headers).tenant.id
  const artifact = store.artifactById(params.id)
  if (!artifact || !store.artifactOwnedBy(artifact, tenantId)) return sendError(res, 'not_found', `No artifact '${params.id}'`)
  const input = await body<unknown>()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return sendError(res, 'bad_request', 'An artifact content edit is required')
  try {
    if (Object.hasOwn(input, 'content')) {
      const patch = parseStructuredArtifactEdit(input)
      if (!patch) return sendError(res, 'bad_request', 'content must be a valid identified Document, sheet, workbook, or slide body and expectedRevision is required; no other fields are accepted')
      const updated = store.updateStructuredArtifactContent(params.id, patch.content, patch.expectedRevision, tenantId)
      if (!updated) return sendError(res, 'bad_request', 'That saved Document, sheet, workbook, or slide content cannot be replaced; body kind cannot change and workbook tabs cannot be discarded')
      return sendJson(res, updated)
    }
    const patch = input as UpdateArtifactContentRequest
    const hasBlock = Object.hasOwn(input, 'block')
    const hasBlockId = Object.hasOwn(input, 'blockId')
    if (Object.keys(input).some((key) => !['block', 'blockId', 'text', 'expectedRevision'].includes(key)) ||
      hasBlock === hasBlockId || typeof patch.text !== 'string' ||
      (hasBlock && typeof patch.block !== 'number') ||
      (hasBlockId && (typeof patch.blockId !== 'string' || !isDocBlockId(patch.blockId)))) {
      return sendError(res, 'bad_request', 'Exactly one valid block (number) or blockId (string) address and text (string) are required')
    }
    if (hasBlockId && patch.expectedRevision === undefined) {
      return sendError(res, 'bad_request', 'Stable blockId edits require expectedRevision')
    }
    if (patch.expectedRevision !== undefined && (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0)) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    const updated = store.updateArtifactBlock(params.id, hasBlockId ? patch.blockId! : patch.block!, patch.text, patch.expectedRevision)
    if (!updated) return sendError(res, 'bad_request', 'That block cannot be edited')
    sendJson(res, updated)
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
    throw error
  }
}
