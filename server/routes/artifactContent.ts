import { parseStructuredArtifactEdit, type UpdateArtifactContentRequest } from '../../contract/index.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { store } from '../store/index.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'

/** One owner-only content door. Legacy prose-block edits retain their existing
 * optional precondition; whole structured replacements always require CAS. */
export async function updateArtifactContent({ req, res, params, body }: Ctx): Promise<void> {
  const tenantId = store.identity(req.headers).tenant.id
  const artifact = store.artifactById(params.id)
  if (!artifact || !store.artifactOwnedBy(artifact, tenantId)) return sendError(res, 'not_found', `No artifact '${params.id}'`)
  const input = await body<unknown>()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return sendError(res, 'bad_request', 'An artifact content edit is required')
  try {
    if (Object.hasOwn(input, 'content')) {
      const patch = parseStructuredArtifactEdit(input)
      if (!patch) return sendError(res, 'bad_request', 'content must be a valid saved sheet or slide body and expectedRevision is required; no other fields are accepted')
      const updated = store.updateStructuredArtifactContent(params.id, patch.content, patch.expectedRevision, tenantId)
      if (!updated) return sendError(res, 'bad_request', 'That saved sheet or slide content cannot be replaced; its type must stay unchanged')
      return sendJson(res, updated)
    }
    const patch = input as UpdateArtifactContentRequest
    if (typeof patch.block !== 'number' || typeof patch.text !== 'string') return sendError(res, 'bad_request', 'block (number) and text (string) are required')
    if (patch.expectedRevision !== undefined && (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0)) {
      return sendError(res, 'bad_request', 'expectedRevision must be a non-negative safe integer')
    }
    const updated = store.updateArtifactBlock(params.id, patch.block, patch.text, patch.expectedRevision)
    if (!updated) return sendError(res, 'bad_request', 'That block cannot be edited')
    sendJson(res, updated)
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
    throw error
  }
}
