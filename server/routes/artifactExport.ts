import { store } from '../store/index.ts'
import { sendError, sendJson, type Ctx } from '../http/respond.ts'

/** One product read through HTTP and both MCP doors. Omitted format has the
 * fixed compatibility meaning Markdown; it never guesses from mutable kind. */
export async function exportArtifact({ req, res, params, url }: Ctx): Promise<void> {
  const tenantId = store.identity(req.headers).tenant.id
  const artifact = store.artifactById(params.id)
  if (!artifact || !store.artifactVisibleToTenant(artifact, tenantId)) return sendError(res, 'not_found', 'No such artifact')
  const formats = url.searchParams.getAll('format')
  const format = formats[0] ?? 'markdown'
  if (formats.length > 1 || (format !== 'markdown' && format !== 'xlsx' && format !== 'pptx')) {
    return sendError(res, 'bad_request', 'Choose one export format: markdown, xlsx or pptx.')
  }
  const exported = format === 'xlsx'
    ? await store.exportArtifactSpreadsheet(params.id, tenantId)
    : format === 'pptx' ? await store.exportArtifactPresentation(params.id, tenantId)
      : store.exportArtifactDocument(params.id, tenantId)
  if (exported === undefined) return sendError(res, 'not_found', 'No such artifact')
  if (exported === null) return sendError(res, 'capability_unavailable', format === 'xlsx'
    ? 'This artifact has no saved sheet content to export as XLSX.'
    : format === 'pptx' ? 'This artifact has no PowerPoint-compatible saved slide content. Unsupported control characters must be removed before export.'
      : 'This artifact has no saved document content to export as Markdown.')
  sendJson(res, exported)
}
