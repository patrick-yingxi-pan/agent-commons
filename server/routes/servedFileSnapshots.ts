/** Explicit saved-copy intake and owner-only Refresh. Ordinary reads and model
 * preparation use the persisted workspace, never this filesystem seam. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isLocalFolderRefreshRequest } from '../../contract/localFolderCapture.ts'
import { isRefreshServedAttachmentRequest } from '../../contract/servedTextSnapshot.ts'
import { ConflictError, ValidationError } from '../conflict.ts'
import { sendError, sendJson } from '../http/respond.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'

export function registerServedFileSnapshotRoutes(
  router: Router,
  denyForeignSession: (req: IncomingMessage, res: ServerResponse, id: string) => boolean,
  accountTransitionSourceMatches: (req: IncomingMessage, res: ServerResponse) => boolean,
): void {
  router.get('/fs/snapshot', ({ res, url }) => {
    const source = url.searchParams.get('source')
    const path = url.searchParams.get('path')
    if (!source || !path) return sendError(res, 'bad_request', 'source and path are required')
    const snapshot = store.fsSnapshot(source, path)
    if (!snapshot) return sendError(res, 'not_found', 'A complete readable text file of 64 KB or less is unavailable on this source.')
    sendJson(res, snapshot)
  })

  router.get('/fs/folder-snapshot', async ({ res, url }) => {
    const source = url.searchParams.get('source')
    const path = url.searchParams.get('path')
    if (!source || !path) return sendError(res, 'bad_request', 'source and path are required')
    const snapshot = await store.fsFolderSnapshot(source, path)
    if (!snapshot) return sendError(res, 'not_found', 'A readable folder within the capture limits is unavailable on this source.')
    sendJson(res, snapshot)
  })

  router.post('/sessions/:id/folders/:folderId/refresh', async ({ req, res, params, body }) => {
    const tenantId = store.identity(req.headers).tenant.id
    const owner = () => {
      if (denyForeignSession(req, res, params.id)) return false
      const session = store.getSession(params.id)
      if (!session) { sendError(res, 'not_found', 'This conversation is unavailable.'); return false }
      if (!store.sessionOwnedBy(session, tenantId)) {
        sendError(res, 'forbidden', 'Only the conversation owner may refresh attached folders.'); return false
      }
      return true
    }
    if (!owner()) return
    const input = await body<unknown>()
    if (!owner()) return
    if (!isRefreshServedAttachmentRequest(input)) {
      return sendError(res, 'bad_request', 'expectedSnapshotId (UUID or null) and a distinct requestId UUID are required.')
    }
    try {
      const state = await store.refreshSessionFolder(params.id, params.folderId, input, tenantId)
      if (!owner()) return
      sendJson(res, state)
    } catch (error) {
      if (!owner()) return
      if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
  })

  router.post('/sessions/:id/local-folders/:folderId/refresh', async ({ req, res, params, body }) => {
    const owner = () => {
      if (!accountTransitionSourceMatches(req, res)) return false
      if (denyForeignSession(req, res, params.id)) return false
      const session = store.getSession(params.id)
      if (!session) { sendError(res, 'not_found', 'This conversation is unavailable.'); return false }
      const tenantId = store.identity(req.headers).tenant.id
      if (!store.sessionOwnedBy(session, tenantId)) {
        sendError(res, 'forbidden', 'Only the conversation owner may refresh attached folders.'); return false
      }
      return true
    }
    if (!owner()) return
    // A body can take arbitrarily long to arrive. Pin the exact attachment
    // instance now so a detach/re-attach of the same opaque ID cannot adopt
    // bytes captured for the previous connection lifetime.
    const initialBinding = store.resolveSessionContext(params.id, params.folderId)
    const input = await body<unknown>()
    // Parsing the body yields; repeat the account, visibility and owner fences
    // before accepting frozen bytes or changing the workspace.
    if (!owner()) return
    if (store.resolveSessionContext(params.id, params.folderId) !== initialBinding) {
      return sendError(res, 'conflict', 'The attached local folder changed while reading. The saved copy is unchanged.')
    }
    if (!isLocalFolderRefreshRequest(input)) {
      return sendError(res, 'bad_request', 'A bounded local-folder capture and matching refresh receipt are required.')
    }
    try {
      const tenantId = store.identity(req.headers).tenant.id
      const state = store.refreshSessionLocalFolder(params.id, params.folderId, input, tenantId)
      if (!owner()) return
      sendJson(res, state)
    } catch (error) {
      if (!owner()) return
      if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
  })

  router.post('/sessions/:id/attachments/:attachmentId/refresh', async ({ req, res, params, body }) => {
    if (denyForeignSession(req, res, params.id)) return
    const session = store.getSession(params.id)
    if (!session) return sendError(res, 'not_found', 'This conversation is unavailable.')
    const tenantId = store.identity(req.headers).tenant.id
    if (!store.sessionOwnedBy(session, tenantId)) {
      return sendError(res, 'forbidden', 'Only the conversation owner may refresh attached files.')
    }
    const input = await body<unknown>()
    // Body parsing yields to the event loop. Recheck both visibility and ownership
    // before validating the request or touching the attached source.
    if (denyForeignSession(req, res, params.id)) return
    const current = store.getSession(params.id)
    if (!current) return sendError(res, 'not_found', 'This conversation is unavailable.')
    if (!store.sessionOwnedBy(current, tenantId)) {
      return sendError(res, 'forbidden', 'Only the conversation owner may refresh attached files.')
    }
    if (!isRefreshServedAttachmentRequest(input)) {
      return sendError(res, 'bad_request', 'expectedSnapshotId (UUID or null) and a distinct requestId UUID are required.')
    }
    try {
      sendJson(res, store.refreshSessionAttachment(params.id, params.attachmentId, input))
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) return sendError(res, error.code, error.message)
      throw error
    }
  })
}
