import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Router } from '../http/router.ts'
import { headerValue, sendBytes, type Ctx } from '../http/respond.ts'
import { store } from '../store/index.ts'
import { fail } from '../taskPartners/protocol.ts'
import { bearer, environmentOf, jsonInput, listPage, requestKey, respond } from '../taskPartners/transport.ts'

const base = '/task-partners/:environment'
const command = base + '/commands/:commandId'
const machineReason = 'Partner service protocol. The assigned worker presents its own scoped credential and signed evidence.'

/** Human requests still meet the normal auth wall. Only protocol routes whose
 * handlers validate the machine credential themselves are reachable unsigned. */
export function isPartnerMachineRequest(path: string, req: IncomingMessage) {
  if (!/^\/task-partners\/(?:sandbox|production)\//.test(path)) return false
  const suffix = path.split('/').slice(3).join('/')
  if (suffix === 'oauth/token') return true
  if (!/^Bearer acp_[A-Za-z0-9_-]+$/.test(headerValue(req.headers, 'authorization') ?? '')) return false
  return /^commands(?:\/|$)/.test(suffix) || /^handoffs\/[^/]+\/(?:exchange|attestations)$/.test(suffix) ||
    /^applications\/[^/]+\/domain-challenges(?:\/[^/]+)?$/.test(suffix)
}
function rawInput(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = []
    let size = 0, failed = false
    req.on('data', chunk => {
      if (failed) return
      const part = chunk as Uint8Array
      size += part.byteLength
      if (size > limit) {
        failed = true
        parts.length = 0
        try { fail(413, 'too_large', 'Request body exceeds its size limit.') } catch (e) { reject(e) }
      } else parts.push(part)
    })
    req.on('error', reject)
    req.on('end', () => { if (!failed) resolve(Buffer.concat(parts)) })
    req.on('close', () => { if (!req.complete) reject(new Error('Request body interrupted.')) })
  })
}
export function registerPartnerWorkerRoutes(router: Router) {
  const registry = store.taskPartners, work = store.partnerWork
  const authorize = (ctx: Ctx, scope: string) => {
    const env = environmentOf(ctx.params.environment)
    return { env, worker: registry.authorizeWorker(env, bearer(ctx.req), scope) }
  }
  function mutation(ctx: Ctx, scope: string, key: string, intent: unknown, run: (worker: ReturnType<typeof registry.authorizeWorker>, env: 'sandbox' | 'production') => unknown, replay?: (partnerId: string, env: 'sandbox' | 'production', result: unknown) => void) {
    const { worker, env } = authorize(ctx, scope)
    const actor = { userId: worker.partnerId, tenantId: 'partner-worker', operator: false, organizationAdmin: false }
    return store.commitPartnerChange(() => registry.mutate(actor, env, scope, ctx.url.pathname, key, intent, () => run(worker, env), value => replay?.(worker.partnerId, env, value)))
  }
  router.formPost(base + '/oauth/token', 'OAuth client-credentials and signed assertion exchange for an enrolled worker.', ctx => respond(ctx, 200, async () => {
    const env = environmentOf(ctx.params.environment)
    if (headerValue(ctx.req.headers, 'content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') {
      return fail(415, 'unsupported_media_type', 'Use application/x-www-form-urlencoded.')
    }
    const form = new URLSearchParams((await rawInput(ctx.req, 32768)).toString('utf8'))
    for (const name of form.keys()) if (form.getAll(name).length !== 1) return fail(400, 'bad_request', 'Duplicate token request field.')
    return registry.issueToken(env, Object.fromEntries(form))
  }))
  router.formGet(base + '/commands', machineReason, ctx => respond(ctx, 200, () => {
    const { worker, env } = authorize(ctx, 'commands:read')
    const rows: { commandId: string }[] = env === 'sandbox' ? registry.sandboxCommands(worker.partnerId) : work.commands(worker, env)
    return listPage(ctx.url, worker.partnerId + '/' + env, rows, c => c.commandId)
  }))
  router.formGet(command, machineReason, ctx => respond(ctx, 200, () => {
    const { worker, env } = authorize(ctx, 'commands:read')
    return env === 'sandbox' ? registry.sandboxCommand(worker.partnerId, ctx.params.commandId!) : work.command(worker, env, ctx.params.commandId!)
  }))
  router.formPost(command + '/receipts', machineReason, ctx => respond(ctx, 200, async () => {
    authorize(ctx, 'receipts:write')
    const body = await jsonInput(ctx)
    return mutation(ctx, 'receipts:write', requestKey(ctx.req), body, (worker, env) => env === 'sandbox'
      ? registry.sandboxReceipt(worker.partnerId, ctx.params.commandId!, body)
      : work.receipt(worker, env, ctx.params.commandId!, body), (partnerId, env, result) => {
        if (env === 'sandbox' && result && typeof result === 'object' && 'receiptId' in result && typeof result.receiptId === 'string') {
          registry.sandboxReplay(partnerId, ctx.params.commandId!, result.receiptId)
        }
      })
  }))
  for (const suffix of ['exchange', 'attestations'] as const) {
    router.formPost(base + '/handoffs/:handoffId/' + suffix, machineReason, ctx => respond(ctx, 200, async () => {
      authorize(ctx, 'handoffs:write')
      const body = await jsonInput(ctx)
      return mutation(ctx, 'handoffs:write', requestKey(ctx.req), body, (worker, env) =>
        suffix === 'exchange' ? work.exchange(worker, env, ctx.params.handoffId!, body) : work.attest(worker, env, ctx.params.handoffId!, body))
    }))
  }
  router.formPost(command + '/artifacts', machineReason, ctx => respond(ctx, 201, async () => {
    authorize(ctx, 'artifacts:write')
    if (headerValue(ctx.req.headers, 'content-type') !== 'application/octet-stream') return fail(415, 'unsupported_media_type', 'Upload binary artifacts as application/octet-stream.')
    const mediaType = headerValue(ctx.req.headers, 'x-artifact-media-type')
    if (!mediaType || mediaType.length > 128) return fail(400, 'bad_request', 'Supply the artifact media type.')
    const supplied = /^sha-256=:([A-Za-z0-9+/]{43}=):$/.exec(headerValue(ctx.req.headers, 'content-digest') ?? '')
    if (!supplied) return fail(400, 'bad_request', 'Supply a SHA-256 Content-Digest.')
    const bytes = await rawInput(ctx.req, 8 * 1024 * 1024)
    const hash = createHash('sha256').update(bytes).digest()
    if (hash.toString('base64') !== supplied[1]) return fail(422, 'digest_mismatch', 'Artifact bytes differ from Content-Digest.')
    const digest = hash.toString('hex')
    return mutation(ctx, 'artifacts:write', requestKey(ctx.req), { mediaType, digest }, (worker, env) => env === 'sandbox'
      ? registry.sandboxUpload(worker.partnerId, ctx.params.commandId!, bytes, mediaType, digest)
      : work.upload(worker, env, ctx.params.commandId!, mediaType, bytes, digest))
  }))
  router.formGet(command + '/artifacts/:artifactId', machineReason, ctx => respond(ctx, 200, () => {
    const { worker, env } = authorize(ctx, 'artifacts:read')
    const args = [ctx.params.commandId!, ctx.params.artifactId!] as const
    const result = env === 'sandbox' ? registry.sandboxArtifact(worker.partnerId, ...args) : work.artifact(worker, env, ...args)
    ctx.res.setHeader('Content-Digest', 'sha-256=:' + Buffer.from(result.digest, 'hex').toString('base64') + ':')
    ctx.res.setHeader('X-Artifact-Media-Type', 'mediaType' in result ? result.mediaType : result.contentType)
    ctx.res.setHeader('Content-Disposition', 'attachment')
    sendBytes(ctx.res, result.bytes, 'application/octet-stream')
  }))
}
