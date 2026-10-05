import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseRestoreArtifactHistoryRequest } from '../../contract/artifactHistory.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { IDEMPOTENCY_KEY_MAX_LENGTH } from '../idempotency.ts'
import { sendError, sendJson } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function revision(value: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function registerArtifactHistoryRoutes(
  router: Router,
  accountTransitionSourceMatches: (req: IncomingMessage, res: ServerResponse) => boolean,
): void {
  router.get('/artifacts/:id/history', ({ req, res, params, url }) => {
    if (!accountTransitionSourceMatches(req, res)) return
    const beforeText = url.searchParams.get('beforeRevision')
    const limitText = url.searchParams.get('limit')
    const beforeRevision = beforeText === null ? undefined : revision(beforeText)
    const limit = limitText === null ? 50 : revision(limitText)
    if ((beforeText !== null && beforeRevision === undefined) || limit === undefined || limit < 1 || limit > 50 ||
      url.searchParams.getAll('beforeRevision').length > 1 || url.searchParams.getAll('limit').length > 1) {
      return sendError(res, 'bad_request', 'beforeRevision must be a non-negative safe revision and limit must be from 1 to 50.')
    }
    const page = store.artifactHistoryPage(params.id, store.identity(req.headers).tenant.id, beforeRevision, limit)
    if (!page) return sendError(res, 'not_found', 'No such editable Artifact history.')
    sendJson(res, page)
  })

  router.get('/artifacts/:id/history/:revision', ({ req, res, params }) => {
    if (!accountTransitionSourceMatches(req, res)) return
    const versionRevision = revision(params.revision)
    if (versionRevision === undefined) return sendError(res, 'bad_request', 'revision must be a non-negative safe integer.')
    const result = store.artifactHistoryVersion(params.id, versionRevision, store.identity(req.headers).tenant.id)
    if (!result) return sendError(res, 'not_found', 'No such Artifact history version.')
    sendJson(res, result)
  })

  // Durable restore receipts live in the canonical snapshot, so this route
  // intentionally bypasses the process-local generic idempotency cache.
  router.post('/artifacts/:id/history/:revision/restore', async ({ req, res, params, body }) => {
    if (!accountTransitionSourceMatches(req, res)) return
    const identity = store.identity(req.headers)
    const versionRevision = revision(params.revision)
    if (versionRevision === undefined) return sendError(res, 'bad_request', 'revision must be a non-negative safe integer.')
    const owned = store.getArtifactLifecycle(params.id, identity.tenant.id)
    if (!owned) return sendError(res, 'not_found', 'No such Artifact history version.')
    const key = header(req, 'idempotency-key')
    if (!key?.trim()) return sendError(res, 'bad_request', 'Idempotency-Key is required for Artifact history restore.')
    if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) return sendError(res, 'bad_request', `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`)
    const input = await body<unknown>()
    if (!accountTransitionSourceMatches(req, res)) return
    const request = parseRestoreArtifactHistoryRequest(input)
    if (!request) return sendError(res, 'bad_request', 'Only a non-negative expectedRevision is accepted.')
    try {
      const result = store.restoreArtifactHistoryVersion(
        params.id, versionRevision, request.expectedRevision, identity.tenant.id, identity.user.id, key,
      )
      if (!result) return sendError(res, 'not_found', 'No such Artifact history version.')
      sendJson(res, result)
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
  })
}
