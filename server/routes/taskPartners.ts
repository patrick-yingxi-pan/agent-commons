import type { Ctx } from '../http/respond.ts'
import { headerValue } from '../http/respond.ts'
import { accounts } from '../accounts.ts'
import type { Router } from '../http/router.ts'
import { store } from '../store/index.ts'
import { fail, record, tokenId } from '../taskPartners/protocol.ts'
import { bearer, environmentOf, jsonInput, listPage, partnerActor, requestKey, respond } from '../taskPartners/transport.ts'
import type { PartnerEnvironment } from '../../contract/taskPartners.ts'
import { registerPartnerHandoffPage } from './taskPartnerHandoffPage.ts'
import { registerPartnerWorkerRoutes } from './taskPartnerWorkers.ts'

const base = '/task-partners/:environment'
const apps = base + '/applications'
const app = apps + '/:applicationId'
const projectDrafts = '/projects/:id/task-drafts'
const task = '/projects/:id/work/:workId/'
type Actor = ReturnType<typeof partnerActor>
type Info = { ctx: Ctx; actor: Actor; env: PartnerEnvironment; p: Ctx['params']; url: URL; listScope: string }
type Operation = (i: Info, body: unknown) => unknown

export function registerTaskPartnerRoutes(router: Router, accountMatches: (req: Ctx['req'], res: Ctx['res']) => boolean) {
  const registry = store.taskPartners, work = store.partnerWork
  function current(ctx: Ctx): Info {
    const { params: p, url } = ctx
    const env = environmentOf(p.environment ?? 'production')
    const actor = partnerActor(ctx.req, store.identity(ctx.req.headers))
    if (p.id && !store.grantSubjectVisible({ kind: 'project', id: p.id }, actor.tenantId)) fail(404, 'not_found', 'Project unavailable.')
    if (p.workId) work.view(actor, p.id!, p.workId)
    if (p.handoffId) work.handoff(actor, env, p.handoffId)
    return { ctx, actor, env, p, url, listScope: JSON.stringify([actor.userId, actor.tenantId, actor.operator, env]) }
  }
  function get(path: string, run: (i: Info) => unknown, query?: Record<string, unknown>) {
    router.get(path, ctx => respond(ctx, 200, () => {
      if (!accountMatches(ctx.req, ctx.res)) return
      return run(current(ctx))
    }), query ? { kind: 'product', query } : undefined)
  }
  function post(path: string, status: number, run: Operation, authorize?: Operation, response?: (i: Info, result: unknown) => unknown) {
    router.post(path, ctx => respond(ctx, status, async () => {
      const body = await jsonInput(ctx)
      if (!accountMatches(ctx.req, ctx.res)) return
      const i = current(ctx)
      if (i.p.applicationId) {
        const { viewer } = registry.application(i.actor, i.env, i.p.applicationId)
        if (path === app + '/decisions' ? !viewer?.canReview : !viewer?.canManage) {
          return fail(403, 'forbidden', 'Your account cannot perform this action on the application.')
        }
      }
      authorize?.(i, body)
      const key = requestKey(ctx.req)
      const result = store.commitPartnerChange(() => registry.mutate(i.actor, i.env, path, ctx.url.pathname, key, body, () => run(i, body)))
      return response ? response(i, result) : result
    }))
  }
  const pages = { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } }
  const term = { type: 'string' }
  get(apps, ({ actor, env, url, listScope }) => {
    const state = url.searchParams.get('state')
    if (state !== null && !['awaiting_proof','sandbox_testing','in_review','active','suspended','revoked','rejected'].includes(state)) fail(400, 'bad_request', 'Unknown application state.')
    const rows = registry.applications(actor, env).filter(a => !state || a.state === state)
    const { webOrigin, badgeOrigin } = store.partnerOrigins()
    return { ...listPage(url, listScope, rows, r => r.applicationId, ['state']), canReview: actor.operator, canManage: actor.organizationAdmin, recoveryRole: actor.recoveryRole ?? null, webOrigin, badgeOrigin }
  }, { ...pages, state: term })
  post(apps, 201, (i, b) => registry.apply(i.actor, i.env, b), ({ actor }) => {
    if (!actor.organizationAdmin) fail(403, 'forbidden', 'An organization administrator must register the partner.')
  })
  get(app, i => registry.application(i.actor, i.env, i.p.applicationId!))
  get(app + '/history', i => listPage(i.url, i.listScope, registry.history(i.actor, i.env, i.p.applicationId!), r => r.recordedAt + r.eventId), pages)
  post(app + '/name', 200, (i, b) => registry.rename(i.actor, i.env, i.p.applicationId!, b))
  post(app + '/keys', 200, (i, b) => registry.keyChange(i.actor, i.env, i.p.applicationId!, b), i => {
    if (!i.actor.freshAuth) fail(403, 'fresh_auth_required', 'Sign in again to manage an organization signing key.')
  })
  post(app + '/proofs', 200, (i, b) => registry.proveKey(i.actor, i.env, i.p.applicationId!, b))
  post(app + '/conformance', 202, (i, b) => registry.conformance(i.actor, i.env, i.p.applicationId!, b))
  get(app + '/conformance/:reportId', i => registry.report(i.actor, i.env, i.p.applicationId!, i.p.reportId!))
  post(app + '/decisions', 200, (i, b) => registry.decide(i.actor, i.env, i.p.applicationId!, b), i => {
    if (!i.actor.freshAuth) fail(403, 'fresh_auth_required', 'Sign in again before deciding a production application.')
  })

  const challenges = app + '/domain-challenges'
  router.post(challenges, ctx => respond(ctx, 201, async () => {
    const body = await jsonInput(ctx), key = requestKey(ctx.req), env = environmentOf(ctx.params.environment)
    const application = ctx.params.applicationId!
    if (headerValue(ctx.req.headers, 'authorization')?.startsWith('Bearer acp_')) {
      const token = bearer(ctx.req), worker = registry.authorizeWorker(env, token, 'domains:renew')
      if (worker.applicationId !== application) return fail(404, 'not_found', 'Application unavailable.')
      const actor = { userId: worker.partnerId, tenantId: 'partner-worker', operator: false, organizationAdmin: false }
      return store.commitPartnerChange(() => registry.mutate(actor, env, challenges, ctx.url.pathname, key, body, () => registry.workerDomainIssue(env, token, application, body)))
    }
    if (!accountMatches(ctx.req, ctx.res)) return
    const i = current(ctx)
    const { viewer } = registry.application(i.actor, env, application)
    if (!viewer?.canManage) return fail(403, 'forbidden', 'An administrator of this organization must request the challenge.')
    if (!i.actor.freshAuth) return fail(403, 'fresh_auth_required', 'Sign in again before requesting domain proof.')
    return store.commitPartnerChange(() => registry.mutate(i.actor, env, challenges, ctx.url.pathname, key, body, () => registry.issueDomain(i.actor, env, application, body)))
  }))
  router.get(challenges + '/:challengeId', ctx => respond(ctx, 200, async () => {
    const { environment, applicationId, challengeId } = ctx.params
    const env = environmentOf(environment)
    if (headerValue(ctx.req.headers, 'authorization')?.startsWith('Bearer acp_')) return registry.workerDomainCheck(env, bearer(ctx.req), applicationId!, challengeId!)
    if (!accountMatches(ctx.req, ctx.res)) return
    const i = current(ctx)
    const result = await registry.checkDomain(i.actor, env, applicationId!, challengeId!)
    if (!accountMatches(ctx.req, ctx.res)) return
    registry.application(current(ctx).actor, env, applicationId!)
    return result
  }))
  get(base + '/catalog', i => {
    const filter = (key: string) => i.url.searchParams.get(key) ?? undefined
    const partnerId = filter('partnerId')
    if (partnerId !== undefined) tokenId(partnerId)
    if (['name','domainAscii','partnerId'].filter(k => filter(k) !== undefined).length > 1) fail(400, 'bad_request', 'Choose a name, exact domain or partner ID.')
    const capability = filter('capability')
    if (capability && !['custodian', 'verifier', 'model-provider'].includes(capability)) fail(400, 'bad_request', 'Unknown partner capability.')
    const rows = i.env === 'production' ? registry.catalog({ name: filter('name'), domainAscii: filter('domainAscii'), capability }) : []
    const visible = rows.filter(r => !partnerId || r.partnerId === partnerId)
      .map(r => ({ ...r, trustedForActor: work.hasCurrentPin(i.actor, r.partnerId, r.identity) }))
    return { ...listPage(i.url, i.listScope, visible, r => r.identity.domainAscii + '/' + r.partnerId, ['name','domainAscii','capability','partnerId']),
      webOrigin: store.partnerOrigins().webOrigin }
  }, { ...pages, name: term, domainAscii: term, capability: term, partnerId: term })

  const taskStates = ['draft', 'published', 'closed', 'cancelled']
  get(projectDrafts, i => {
    const state = i.url.searchParams.get('state')
    if (state !== null && !taskStates.includes(state)) return fail(400, 'bad_request', 'Choose a supported task state.')
    const visible = work.list(i.actor, i.p.id!)
    const rows = state === null ? visible : visible.filter(task => task.status === state)
    return listPage(i.url, i.listScope, rows, row => row.taskId, ['state'])
  }, { ...pages, state: { type: 'string', enum: taskStates } })
  get('/task-partners/balance', i => work.balance(i.actor))
  post('/task-partners/credit-grants', 201, (i, b) => {
    const { tenantId, userId, ...grant } = record(b)
    const recipient = accounts.identityFor(tokenId(userId), tokenId(tenantId))
    if (!recipient) return fail(404, 'not_found', 'Recipient account unavailable.')
    return work.issueCredits(i.actor, { userId: recipient.user.id, tenantId: recipient.tenant.id }, grant)
  }, i => { if (!i.actor.operator || !i.actor.freshAuth) fail(403, 'fresh_auth_required', 'Sign in as a site operator to issue work credits.') })
  post(projectDrafts, 201, (i, b) => work.createDraft(i.actor, i.p.id!, b))
  get(task + 'terms', i => work.view(i.actor, i.p.id!, i.p.workId!))
  post(task + 'terms', 200, (i, b) => work.saveTerms(i.actor, i.p.id!, i.p.workId!, b))
  post(task + 'revisions', 201, (i, b) => work.revise(i.actor, i.p.id!, i.p.workId!, b))
  post(task + 'publish', 200, (i, b) => work.publish(i.actor, i.p.id!, i.p.workId!, b))
  post(task + 'fund', 200, (i, b) => work.fundFromBalance(i.actor, i.p.id!, i.p.workId!, b))
  post(task + 'claim', 200, (i, b) => work.claim(i.actor, i.p.id!, i.p.workId!, b))
  post(task + 'submissions', 201, (i, b) => work.submit(i.actor, i.p.id!, i.p.workId!, b))
  get(task + 'submissions/:submissionId/output', i => {
    const bounds: { offset?: number; length?: number } = {}
    for (const [k, v] of i.url.searchParams) {
      if ((k !== 'offset' && k !== 'length') || !/^(0|[1-9][0-9]{0,8})$/.test(v) || i.url.searchParams.getAll(k).length !== 1)
        return fail(400, 'bad_request', 'Supply numeric offset and length.')
      bounds[k] = Number(v)
    }
    return work.submissionOutput(i.actor, i.p.id!, i.p.workId!, i.p.submissionId!, bounds)
  }, { offset: {type:'integer',minimum:0}, length: {type:'integer',minimum:1,maximum:65536} })
  post(task + 'cancel', 200, (i, b) => work.cancel(i.actor, i.p.id!, i.p.workId!, b))
  const handoffs = base + '/handoffs'
  post(handoffs, 201, (i, b) => work.prepareHandoff(i.actor, i.env, b), (i, b) => {
    const input = record(b), taskId = tokenId(input.taskId)
    work.view(i.actor, work.projectForTask(taskId), taskId)
    registry.machineEnrollment(i.env, tokenId(input.partnerId))
  }, (i, result) => work.startResponse(i.actor, i.env, { handoffId: tokenId(record(result).handoffId) }))
  get(handoffs + '/:handoffId', i => work.handoff(i.actor, i.env, i.p.handoffId!))
  post(handoffs + '/:handoffId/decisions', 200, (i, b) => work.decideHandoff(i.actor, i.env, i.p.handoffId!, b))
  const obligations = base + '/obligations'
  get(obligations, i => {
    const partner = i.url.searchParams.get('partnerId'), taskId = i.url.searchParams.get('taskId')
    const rows = work.obligations(i.actor, i.env).filter(o => (!partner || o.partnerId === partner) && (!taskId || o.taskId === taskId))
    return listPage(i.url, i.listScope, rows, o => o.obligationId, ['partnerId','taskId'])
  }, { ...pages, partnerId: term, taskId: term })
  post(obligations + '/:obligationId/recoveries', 200, (i, b) => work.recover(i.actor, i.env, i.p.obligationId!, b), i => {
    if (!i.actor.operator || !i.actor.freshAuth || !i.actor.recoveryRole) fail(403,'fresh_auth_required','Recovery requires a freshly signed-in incident or settlement operator.')
  })
  get(obligations + '/:obligationId/recoveries/:recoveryId', i => work.recovery(i.actor, i.env, i.p.obligationId!, i.p.recoveryId!))
  registerPartnerHandoffPage(router)
  registerPartnerWorkerRoutes(router)
}
