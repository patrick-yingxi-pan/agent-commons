import { isDeepStrictEqual } from 'node:util'
import { deriveServerSecret } from '../auth.ts'
import type {
  PartnerTaskView,
  PartnerTaskTerms,
  TaskArtifact,
  TaskPartnerCommand,
  TaskAction,
  TaskHandoff,
  PartnerGrant,
  TaskVersion,
} from '../../contract/taskPartnerWork.ts'
import { SITE_CUSTODIAN_ID, SITE_WORK_CREDIT } from '../../contract/taskPartnerWork.ts'
import type { PartnerEnvironment, PartnerIdentity, PartnerPublicProfile } from '../../contract/taskPartners.ts'
import { fail, fields, id, iso, record, tokenId } from './protocol.ts'
import { digest, validatePartnerOutcome } from './dispatcher.ts'
import type { VerifiedOutcome } from './dispatcher.ts'
import { WorkStorage } from './taskStorage.ts'
import type {
  WorkCommand,
  WorkTask,
  WorkSubmission,
  WorkHandoff,
  WorkObligation,
  WorkRecovery,
  StoredReceipt,
} from './taskStorage.ts'
import {
  actorRef,
  assertTermsAvailable,
  checkNonce,
  conflict,
  hash,
  missing,
  parseTerms,
  textField,
} from './taskTerms.ts'
import type { WorkActor, TaskPartnerDirectory } from './taskTerms.ts'
import type { StoredOpenSubGoal, StoredWorkItemComment } from '../persistence/format.ts'

export interface WorkOptions {
  directory: TaskPartnerDirectory
  audience: string
  now?: () => number
  changed?: () => void
  onPublish?: (view: PartnerTaskView) => void
  tenantLabel?: (tenantId: string) => string
  onBacklogChanged?: (item: StoredOpenSubGoal, transition: 'posted' | 'closed' | 'changed') => void
  canAccessProject?: (actor: WorkActor, projectId: string) => boolean
  verifyRecovery?: (
    env: PartnerEnvironment,
    partnerId: string,
    jws: string,
  ) => { kid: string; claims: Record<string, unknown> }
}
type Worker = { partnerId: string }
const version = (t: TaskVersion): TaskVersion => ({
  taskId: t.taskId,
  termsVersion: t.termsVersion,
  termsDigest: t.termsDigest,
})
const scope = (a: string, b: string) => JSON.stringify([a, b])
const prod = (env: PartnerEnvironment) => {
  if (env !== 'production') missing()
}
function assertVersion(task: TaskVersion, input: Record<string, unknown>) {
  if (input.termsVersion !== task.termsVersion || input.termsDigest !== task.termsDigest)
    conflict('The task terms changed. Review the current version.')
}
function protectedCommandInput(action: TaskAction): TaskArtifact[] {
  return action.kind === 'run' ? [action.input] : action.kind === 'verify' ? [action.submission, ...action.inputs] : []
}
const uploadTypes = new Set(['text/plain', 'application/json', 'application/octet-stream'])

export class PartnerWorkService {
  private db: WorkStorage
  private opts: WorkOptions
  private now: () => number
  constructor(options: WorkOptions) {
    this.opts = options
    this.now = options.now ?? Date.now
    this.db = new WorkStorage(options.changed ?? (() => {}), (task, prior) => {
      if (!this.opts.onBacklogChanged || !task.publishedAt) return
      const transition = !prior?.publishedAt
        ? 'posted'
        : task.status !== prior.status && task.status !== 'published'
          ? 'closed'
          : 'changed'
      this.opts.onBacklogChanged(this.thread(task), transition)
    })
  }
  snapshot() {
    return this.db.snapshot()
  }
  restore(snapshot: unknown) {
    this.db.restore(snapshot)
  }
  projectForTask(taskId: string) {
    return this.task(taskId).projectId
  }
  projectForHandoff(handoffId: string) {
    return this.projectForTask(this.handoffRecord(handoffId).view.taskId)
  }
  private task(key: string) {
    return this.db.get('tasks', key) ?? missing()
  }
  private handoffRecord(key: string) {
    return this.db.get('handoffs', key) ?? missing()
  }
  private checkProject(actor: WorkActor, projectId: string) {
    if (!actor.userId || !actor.tenantId || !this.opts.canAccessProject?.(actor, projectId)) missing()
  }
  private visible(actor: WorkActor, projectId: string, taskId: string) {
    this.checkProject(actor, projectId)
    const task = this.task(taskId)
    if (task.projectId !== projectId || (!task.publishedAt && task.owner !== actorRef(actor))) missing()
    return task
  }
  private owner(actor: WorkActor, task: WorkTask) {
    if (task.owner !== actorRef(actor)) fail(403, 'forbidden', 'Only the requester can change this task.')
  }
  private expose(actor: WorkActor, task: WorkTask): PartnerTaskView {
    const who = actorRef(actor)
    return structuredClone({
      ...version(task),
      projectId: task.projectId,
      terms: task.terms,
      status: task.status,
      requester: task.owner === who,
      claim: !task.claimant ? 'available' : task.claimant === who ? 'mine' : 'taken',
      funding: task.funding,
      ...(task.publishedAt && { publishedAt: task.publishedAt }),
      ...(task.winnerId && { winnerId: task.winnerId }),
      ...(task.previousOffer && { previousOffer: task.previousOffer }),
      submissions: task.submissions.map(({ author, artifact: _artifact, ...s }) => ({ ...s, mine: author === who })),
      partners: Object.values(task.pinned).map((p) => {
        try {
          const current = this.opts.directory.publicProfile(p.partnerId)
          return {
            ...p,
            status:
              current.identity.domainAscii === p.domainAscii && current.identity.identityRevision === p.identityRevision
                ? current.status
                : 'verification_lapsed',
          }
        } catch (e) {
          if (!isIneligible(e)) throw e
          return { ...p, status: 'unavailable' }
        }
      }),
    })
  }
  view(actor: WorkActor, projectId: string, taskId: string) {
    return this.expose(actor, this.visible(actor, projectId, taskId))
  }
  list(actor: WorkActor, projectId: string) {
    this.checkProject(actor, projectId)
    return this.db
      .all('tasks')
      .filter((t) => t.projectId === projectId && (t.publishedAt || t.owner === actorRef(actor)))
      .map((t) => this.expose(actor, t))
  }
  /** Internal cross-collection projection. Only published rows enter the
   * ordinary backlog; its legacy dispatch queue never stores a second copy. */
  private thread(task: WorkTask): StoredOpenSubGoal {
    const { taskId: id, projectId, terms, author, publishedAt, postedAs, comments } = task
    if (!publishedAt || !postedAs) return missing()
    const headline = terms.description.split(/\r?\n/, 1)[0]
    return {
      id,
      projectId,
      type: 'task',
      subGoal: headline || terms.description,
      target: terms.reward ? terms.reward.asset.quantity + ' ' + terms.reward.asset.unit : 'Volunteer',
      note: terms.description,
      postedAt: Date.parse(publishedAt),
      postedBy: postedAs,
      postedByTenant: author.tenantId,
      postedByPrincipal: { kind: 'user', id: author.userId },
      comments: structuredClone(comments),
      status: task.status === 'published' ? 'open' : task.winnerId ? 'done' : 'retracted',
    }
  }
  publishedThreads(projectId?: string): StoredOpenSubGoal[] {
    return this.db
      .all('tasks')
      .filter((t) => t.publishedAt && (!projectId || t.projectId === projectId))
      .map((t) => this.thread(t))
  }
  publishedThread(projectId: string, taskId: string): StoredOpenSubGoal | undefined {
    const t = this.db.get('tasks', taskId)
    return t?.publishedAt && t.projectId === projectId ? this.thread(t) : undefined
  }
  appendThreadComment(projectId: string, taskId: string, comment: StoredWorkItemComment) {
    // Called only by the existing visibility-checked comment funnel, which
    // also owns idempotency, normalized text, mentions, caps and notifications.
    const t = this.task(taskId)
    if (!t.publishedAt || t.projectId !== projectId) return missing()
    if (t.comments.length >= 100 || t.comments.some((c) => c.id === comment.id))
      conflict('This thread cannot accept the comment.')
    this.db.transaction(() => {
      this.db.edit('tasks', taskId).comments.push(structuredClone(comment))
    })
  }
  private putArtifact(bytes: Uint8Array, mediaType: string, uploadedFor?: string): TaskArtifact {
    const raw = Buffer.from(bytes),
      digest = hash(raw)
    const artifactId = 'artifact-' + hash(JSON.stringify([uploadedFor ?? 'task-input', mediaType, digest]))
    const existing = this.db.get('artifacts', artifactId)
    if (existing) return existing.ref
    const ref = { artifactId, digest, mediaType }
    this.db.put('artifacts', artifactId, { ref, bytes: raw.toString('base64'), created: this.now(), uploadedFor })
    return ref
  }
  createDraft(actor: WorkActor, projectId: string, body: unknown) {
    this.checkProject(actor, projectId)
    return this.newDraft(actor, projectId, parseTerms(body, this.now()))
  }
  revise(actor: WorkActor, projectId: string, taskId: string, raw: unknown) {
    const from = this.visible(actor, projectId, taskId)
    this.owner(actor, from)
    const input = fields(raw, ['terms', 'termsVersion', 'termsDigest'])
    assertVersion(from, input)
    if (!from.publishedAt) return conflict('Edit the current draft before publication.')
    return this.newDraft(actor, projectId, parseTerms(input.terms, this.now()), version(from))
  }
  private newDraft(actor: WorkActor, projectId: string, terms: PartnerTaskTerms, previousOffer?: TaskVersion) {
    const owner = actorRef(actor)
    return this.db.transaction(() => {
      const tasks = this.db.all('tasks')
      const successor =
        previousOffer && tasks.find((t) => t.previousOffer?.taskId === previousOffer.taskId && t.status !== 'cancelled')
      if (successor) {
        if (successor.status === 'draft' && isDeepStrictEqual(successor.terms, terms))
          return this.expose(actor, successor)
        return conflict('This offer already has a revision. Open the latest revision to make changes.')
      }
      if (tasks.filter((t) => t.owner === owner && t.status === 'draft').length >= 100)
        return fail(429, 'draft_limit', 'Finish an existing draft before creating another.')
      const taskId = id('task'),
        termsVersion = (previousOffer?.termsVersion ?? 0) + 1
      const task: WorkTask = {
        projectId,
        taskId,
        owner,
        author: { tenantId: actor.tenantId, userId: actor.userId },
        comments: [],
        terms,
        termsVersion,
        termsDigest: hash(JSON.stringify([taskId, termsVersion, terms])),
        status: 'draft',
        funding: terms.reward ? 'awaiting' : 'volunteer',
        submissions: [],
        pinned: {},
        priorTerms: [],
        createdAt: iso(this.now()),
        ...(previousOffer && { previousOffer }),
        input: this.putArtifact(Buffer.from(terms.description), 'text/plain'),
      }
      this.db.put('tasks', taskId, task)
      return this.expose(actor, task)
    })
  }
  saveTerms(actor: WorkActor, projectId: string, taskId: string, body: unknown) {
    const row = fields(body, ['expectedVersion', 'terms'])
    const old = this.visible(actor, projectId, taskId)
    this.owner(actor, old)
    if (old.termsVersion !== row.expectedVersion) conflict('Review the latest draft before saving changes.')
    if (old.status !== 'draft' || old.reserveCommand)
      conflict('These terms are committed. Create a new draft to offer revised terms.')
    const terms = parseTerms(row.terms, this.now())
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      t.priorTerms.push({ termsVersion: t.termsVersion, termsDigest: t.termsDigest, terms: t.terms })
      t.terms = terms
      t.termsVersion++
      t.termsDigest = hash(JSON.stringify([taskId, t.termsVersion, terms]))
      t.funding = terms.reward ? 'awaiting' : 'volunteer'
      t.input = this.putArtifact(Buffer.from(terms.description), 'text/plain')
      return this.expose(actor, t)
    })
  }
  private checkDeadline(task: WorkTask) {
    if (task.terms.deadline && Date.parse(task.terms.deadline) <= this.now())
      fail(410, 'deadline_elapsed', 'This task has reached its submission deadline.')
  }
  private checkSelection(actor: WorkActor, partnerId: string, expected?: unknown) {
    const profile = this.opts.directory.publicProfile(partnerId)
    if (profile.status !== 'active' || Date.parse(profile.identity.validUntil) <= this.now())
      fail(409, 'identity_inactive', 'This partner no longer has a current verified identity.')
    const observed = { domainAscii: profile.identity.domainAscii, identityRevision: profile.identity.identityRevision }
    const actorKey = scope(actorRef(actor), partnerId),
      prior = this.db.get('pins', actorKey)
    if (expected !== undefined) {
      const value = fields(expected, ['domainAscii', 'identityRevision'])
      if (value.domainAscii !== observed.domainAscii)
        fail(409, 'identity_mismatch', 'The domain does not match the selected organization.')
      if (value.identityRevision !== observed.identityRevision)
        fail(409, 'stale_identity', 'Review the updated partner identity.')
    } else if ((prior && !isDeepStrictEqual(prior, observed)) || (!prior && profile.identity.collisionSignals.length))
      fail(409, 'identity_confirmation_required', 'Enter the exact domain from a source you trust.')
    this.db.put('pins', actorKey, observed)
    return profile
  }
  hasCurrentPin(actor: WorkActor, partnerId: string, identity: PartnerIdentity) {
    const pin = this.db.get('pins', scope(actorRef(actor), partnerId))
    return (
      !!pin &&
      pin.domainAscii === identity.domainAscii &&
      pin.identityRevision === identity.identityRevision &&
      Date.parse(identity.validUntil) > this.now()
    )
  }
  private checkBindings(task: WorkTask) {
    for (const [partnerId, expected] of Object.entries(task.pinned)) {
      const current = this.opts.directory.publicProfile(partnerId)
      if (
        current.status !== 'active' ||
        current.identity.domainAscii !== expected.domainAscii ||
        current.identity.identityRevision !== expected.identityRevision ||
        Date.parse(current.identity.validUntil) <= this.now()
      )
        fail(409, 'stale_identity', 'The task references a partner identity that changed.')
    }
  }
  publish(actor: WorkActor, projectId: string, taskId: string, body: unknown) {
    const old = this.visible(actor, projectId, taskId)
    this.owner(actor, old)
    const row = fields(body, ['termsVersion', 'termsDigest'], ['expectedIdentities'])
    assertVersion(old, row)
    if (old.publishedAt) return this.expose(actor, old)
    if (old.status !== 'draft') conflict('This draft is closed.')
    this.checkDeadline(old)
    assertTermsAvailable(this.opts.directory, old.terms)
    if (old.terms.reward && (old.funding !== 'held' || this.recoveryOpen(old)))
      conflict('The custodian has not confirmed the complete reward.')
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      this.checkBindings(t)
      const expected = row.expectedIdentities === undefined ? {} : record(row.expectedIdentities)
      const partners = new Set([
        t.terms.provenance?.partnerId,
        t.terms.reward?.partnerId,
        t.terms.acceptance?.kind === 'partner' ? t.terms.acceptance.partnerId : undefined,
      ])
      for (const partner of partners)
        if (partner && partner !== SITE_CUSTODIAN_ID) {
          const profile = this.checkSelection(actor, partner, expected[partner])
          t.pinned[partner] = this.freezePartner(profile)
        }
      t.status = 'published'
      t.publishedAt = iso(this.now())
      t.postedAs = this.opts.tenantLabel?.(actor.tenantId) ?? 'Requester'
      const view = this.expose(actor, t)
      this.opts.onPublish?.(view)
      return view
    })
  }
  private openFor(task: WorkTask, who: string) {
    if (task.status !== 'published' || task.winnerId) conflict('This task is no longer accepting work.')
    this.checkDeadline(task)
    if (task.terms.reward && (task.funding !== 'held' || this.recoveryOpen(task)))
      conflict('This reward requires reconciliation.')
    if (task.terms.participation === 'single-claim' && task.claimant !== who)
      conflict('Claim this task before starting work.')
    this.checkBindings(task)
  }
  private recoveryOpen(task: WorkTask) {
    return !!task.obligationId && this.db.get('obligations', task.obligationId)?.state === 'in_recovery'
  }
  claim(actor: WorkActor, projectId: string, taskId: string, body: unknown) {
    const old = this.visible(actor, projectId, taskId)
    const row = fields(body, ['termsVersion', 'termsDigest'])
    assertVersion(old, row)
    if (old.terms.participation !== 'single-claim' || old.status !== 'published' || old.winnerId)
      conflict('This task does not offer an exclusive claim.')
    this.checkDeadline(old)
    this.checkBindings(old)
    const who = actorRef(actor)
    if (old.claimant && old.claimant !== who) conflict('Another contributor already claimed this task.')
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      t.claimant = who
      return this.expose(actor, t)
    })
  }
  submit(actor: WorkActor, projectId: string, taskId: string, raw: unknown) {
    const body = fields(raw, ['text', 'termsVersion', 'termsDigest'])
    const old = this.visible(actor, projectId, taskId),
      who = actorRef(actor)
    assertVersion(old, body)
    this.openFor(old, who)
    const text = textField(body.text, 16_384),
      bytes = Buffer.from(text)
    if (old.terms.provenance) conflict('Authorize the required provider to run and attest this submission.')
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      const s = this.addSubmission(t, who)
      s.text = text
      this.evaluate(t, s, this.putArtifact(bytes, 'text/plain'))
      return this.expose(actor, t)
    })
  }
  private addSubmission(task: WorkTask, author: string) {
    if (task.submissions.length >= 512) fail(429, 'submission_limit', 'This task reached its submission limit.')
    const item: WorkSubmission = {
      submissionId: id('sub'),
      author,
      submittedAt: iso(this.now()),
      verdict: task.terms.acceptance ? 'pending' : 'open',
      provenance: task.terms.provenance ? 'pending' : 'optional',
    }
    task.submissions.push(item)
    return item
  }
  private evaluate(task: WorkTask, s: WorkSubmission, ref: TaskArtifact) {
    s.artifact = ref
    s.digest = ref.digest
    const rule = task.terms.acceptance
    if (rule?.kind === 'sha256-prefix') {
      const bytes = this.db.get('artifacts', ref.artifactId) ?? missing()
      s.verdict = checkNonce(rule.prefix, Buffer.from(bytes.bytes, 'base64'), rule.difficultyBits)
        ? 'passed'
        : 'rejected'
    } else if (rule?.kind === 'partner') {
      this.enqueue(task, rule.partnerId, {
        kind: 'verify',
        submissionId: s.submissionId,
        submission: ref,
        rule: rule.rule,
        inputs: [task.input],
      })
    }
    this.chooseWinner(task, s)
  }
  private chooseWinner(task: WorkTask, s: WorkSubmission) {
    if (
      !task.terms.reward ||
      task.status !== 'published' ||
      task.winnerId ||
      s.verdict !== 'passed' ||
      (task.terms.provenance && s.provenance !== 'attested')
    )
      return
    task.winnerId = s.submissionId
    task.status = 'closed'
    if (task.terms.reward.partnerId === SITE_CUSTODIAN_ID) this.settleSiteHold(task, s)
  }
  private enqueue(task: WorkTask, partnerId: string, action: TaskAction, handoff?: WorkHandoff) {
    const now = this.now(),
      commandId = id('cmd')
    const view: TaskPartnerCommand = {
      ...version(task),
      commandId,
      partnerId,
      environment: 'production',
      issuedAt: iso(now),
      deadline:
        action.kind === 'return' || action.kind === 'release'
          ? task.terms.reward!.holdUntil
          : action.kind === 'reserve'
            ? action.holdUntil
            : (task.terms.deadline ?? iso(now + 86_400_000)),
      state: 'requested',
      action,
    }
    this.db.put('commands', commandId, { view, owner: handoff?.owner, handoffId: handoff?.view.handoffId })
    return view
  }
  cancel(actor: WorkActor, projectId: string, taskId: string, body: unknown) {
    const old = this.visible(actor, projectId, taskId)
    this.owner(actor, old)
    const row = fields(body, ['termsVersion', 'termsDigest'])
    assertVersion(old, row)
    if (
      old.winnerId ||
      this.recoveryOpen(old) ||
      old.funding === 'uncertain' ||
      old.funding === 'reserving' ||
      old.submissions.some((s) => s.verdict === 'pending' || s.provenance === 'pending')
    )
      conflict('Resolve outstanding work and entitlements first.')
    if (old.status === 'cancelled') return this.expose(actor, old)
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      t.status = 'cancelled'
      if (t.funding === 'held') this.returnHold(t)
      return this.expose(actor, t)
    })
  }
  private returnHold(t: WorkTask) {
    const reward = t.terms.reward!
    if (reward.partnerId === SITE_CUSTODIAN_ID) {
      this.settleSiteHold(t)
      return
    }
    const original = this.db.get('commands', t.reserveCommand!)?.view.action
    if (original?.kind !== 'reserve') return conflict('Reconcile the original reservation before returning it.')
    const command = this.enqueue(t, reward.partnerId, {
      kind: 'return',
      reservationId: t.reservationId!,
      asset: reward.asset,
      payerRef: original.payerRef,
    })
    t.payoutCommand = command.commandId
    t.funding = 'returning'
    this.markObligation(t, command, 'settlement_pending')
  }
  private markObligation(t: WorkTask, command: TaskPartnerCommand, state: WorkObligation['state']) {
    const idKey =
      command.action.kind === 'run' || command.action.kind === 'verify'
        ? command.commandId
        : (t.obligationId ?? command.commandId)
    const old = this.db.get('obligations', idKey)
    const o: WorkObligation = {
      ...version(t),
      ...old,
      obligationId: idKey,
      partnerId: command.partnerId,
      revision: (old?.revision ?? 0) + 1,
      openedAt: old?.openedAt ?? iso(this.now()),
      commandId: command.commandId,
      state,
      ...(t.reservationId && { reservationId: t.reservationId }),
      ...(t.terms.reward && command.partnerId === t.terms.reward.partnerId && { asset: t.terms.reward.asset }),
    }
    if (command.action.kind !== 'run' && command.action.kind !== 'verify') t.obligationId = idKey
    this.db.put('obligations', idKey, o)
    return o
  }
  private grantFor(t: WorkTask, actor: WorkActor, partnerId: string, purpose: unknown): PartnerGrant {
    const who = actorRef(actor)
    if (partnerId === SITE_CUSTODIAN_ID)
      return fail(422, 'internal_custody', 'Use your Agent Commons work-credit balance for this reward.')
    if (purpose === 'reserve' && t.terms.reward?.partnerId === partnerId) {
      this.owner(actor, t)
      this.checkDeadline(t)
      if (t.status !== 'draft' || t.funding !== 'awaiting')
        conflict('This reward already has a reservation or an outstanding operation.')
      return { kind: 'reserve', asset: t.terms.reward.asset, holdUntil: t.terms.reward.holdUntil }
    }
    if (purpose === 'run' && t.terms.provenance?.partnerId === partnerId) {
      this.openFor(t, who)
      if (t.submissions.some((s) => s.author === who && s.provenance === 'pending'))
        conflict('An authorized run is already in progress.')
      const { model, effort, maxInputTokens, maxOutputTokens } = t.terms.provenance
      return {
        kind: 'run',
        model,
        ...(effort !== undefined && { effort }),
        maxInputTokens,
        maxOutputTokens,
        inputDigest: t.input.digest,
      }
    }
    if (purpose === 'receive' && t.terms.reward?.partnerId === partnerId) {
      const winner = t.submissions.find((s) => s.submissionId === t.winnerId)
      if (!winner || winner.author !== who || t.funding !== 'held' || t.payoutCommand || this.recoveryOpen(t))
        fail(403, 'forbidden', 'An available earned award is required to select a destination.')
      if (Date.parse(t.terms.reward.holdUntil) <= this.now())
        conflict('The holder must reconcile the expired reservation before release.')
      return { kind: 'receive', asset: t.terms.reward.asset }
    }
    return fail(422, 'invalid_grant', 'This partner and authorization purpose are not part of the task terms.')
  }
  startHandoff(actor: WorkActor, env: PartnerEnvironment, raw: unknown) {
    return this.startResponse(actor, env, this.prepareHandoff(actor, env, raw))
  }
  private startCode(view: TaskHandoff, owner: string, nonce: string) {
    const material = JSON.stringify([
      this.opts.audience,
      view.environment,
      view.partnerId,
      view.handoffId,
      view.termsDigest,
      owner,
      nonce,
    ])
    return 'code-' + deriveServerSecret('task-partner-handoff-start-v1', material).toString('base64url')
  }
  /** The durable idempotency journal stores only this handle. */
  prepareHandoff(actor: WorkActor, env: PartnerEnvironment, raw: unknown) {
    prod(env)
    const body = fields(raw, ['taskId', 'termsVersion', 'termsDigest', 'partnerId', 'purpose'], ['expectedIdentity'])
    const taskId = tokenId(body.taskId),
      partnerId = tokenId(body.partnerId)
    const t = this.visible(actor, this.projectForTask(taskId), taskId)
    assertVersion(t, body)
    assertTermsAvailable(this.opts.directory, t.terms)
    this.checkBindings(t)
    const grant = this.grantFor(t, actor, partnerId, body.purpose)
    const enrollment = this.opts.directory.machineEnrollment(env, partnerId)
    return this.db.transaction(() => {
      const profile = this.checkSelection(actor, partnerId, body.expectedIdentity)
      const owner = actorRef(actor),
        now = this.now()
      if (
        this.db
          .all('handoffs')
          .filter(
            (h) =>
              h.owner === owner &&
              h.view.expiresAt > iso(now) &&
              ['started', 'exchanged', 'attested', 'confirmed'].includes(h.view.state),
          ).length >= 20
      )
        return fail(429, 'handoff_limit', 'Finish an existing account authorization first.')
      const handoffId = id('grant'),
        nonce = id('nonce'),
        expiresAt = iso(now + 300_000)
      const startUrl = new URL(enrollment.handoffUrl),
        handoffDomainAscii = startUrl.hostname
      const view: TaskHandoff = {
        ...version(t),
        partnerId,
        environment: 'production',
        handoffId,
        grant,
        identity: profile.identity,
        handoffDomainAscii,
        expiresAt,
        state: 'started',
      }
      this.db.put('handoffs', handoffId, {
        view,
        owner,
        partnerActor: id('subject'),
        actor: { tenantId: actor.tenantId, userId: actor.userId },
        startCodeHash: hash(this.startCode(view, owner, nonce)),
        nonce,
        startUrl: startUrl.href,
      })
      return { handoffId }
    })
  }
  startResponse(actor: WorkActor, env: PartnerEnvironment, handle: { handoffId: string }) {
    const view = this.handoff(actor, env, handle.handoffId)
    if (view.state !== 'started') return conflict('This one-use authorization is no longer available.')
    const saved = this.handoffRecord(view.handoffId)
    this.currentGrant(saved)
    const startCode = this.startCode(view, saved.owner, saved.nonce)
    if (hash(startCode) !== saved.startCodeHash) return conflict('Start a new authorization for this deployment.')
    const { handoffId, expiresAt, identity, handoffDomainAscii } = view
    return { handoffId, startUrl: saved.startUrl, startCode, expiresAt, identity, handoffDomainAscii }
  }
  private effectiveHandoff(h: WorkHandoff): TaskHandoff['state'] {
    if (
      ['started', 'exchanged', 'attested', 'confirmed'].includes(h.view.state) &&
      Date.parse(h.view.expiresAt) <= this.now()
    )
      return 'expired'
    return h.view.state
  }
  handoff(actor: WorkActor, env: PartnerEnvironment, key: string) {
    prod(env)
    const h = this.handoffRecord(key)
    if (h.owner !== actorRef(actor)) missing()
    this.visible(actor, this.projectForTask(h.view.taskId), h.view.taskId)
    return structuredClone({ ...h.view, state: this.effectiveHandoff(h) })
  }
  private assignedHandoff(worker: Worker, env: PartnerEnvironment, key: string) {
    prod(env)
    const h = this.handoffRecord(key)
    if (h.view.partnerId !== worker.partnerId) missing()
    return h
  }
  private currentGrant(h: WorkHandoff) {
    const t = this.task(h.view.taskId)
    this.checkProject(h.actor, t.projectId)
    this.checkBindings(t)
    assertVersion(t, { ...h.view })
    const profile = this.opts.directory.publicProfile(h.view.partnerId)
    if (
      profile.status !== 'active' ||
      profile.identity.domainAscii !== h.view.identity.domainAscii ||
      profile.identity.identityRevision !== h.view.identity.identityRevision ||
      Date.parse(profile.identity.validUntil) <= this.now()
    )
      fail(409, 'stale_identity', 'This organization changed since authorization began.')
    const entry = this.opts.directory.machineEnrollment('production', h.view.partnerId)
    if (new URL(entry.handoffUrl).href !== h.startUrl)
      conflict('The registered sign-in endpoint changed. Start a new handoff.')
    assertTermsAvailable(this.opts.directory, t.terms)
    if (!isDeepStrictEqual(this.grantFor(t, h.actor, h.view.partnerId, h.view.grant.kind), h.view.grant))
      conflict('The original grant no longer matches the task.')
    if (this.effectiveHandoff(h) === 'expired') fail(410, 'expired', 'This authorization has expired.')
    return t
  }
  exchange(worker: Worker, env: PartnerEnvironment, key: string, raw: unknown) {
    const old = this.assignedHandoff(worker, env, key),
      { startCode } = fields(raw, ['startCode'])
    if (old.view.state !== 'started' || hash(tokenId(startCode)) !== old.startCodeHash)
      conflict('This one-use authorization code is unavailable.')
    const task = this.currentGrant(old)
    return this.db.transaction(() => {
      const h = this.db.edit('handoffs', key)
      h.view.state = 'exchanged'
      h.startCodeHash = ''
      const { handoffId, partnerId, expiresAt, grant } = h.view
      return {
        ...version(task),
        handoffId,
        partnerId,
        environment: env,
        actorRef: h.partnerActor,
        nonce: h.nonce,
        expiresAt,
        grant,
        workSummary: task.terms.description.slice(0, 1000),
      }
    })
  }
  private verifyEnvelope(partner: string, signed: unknown, typ: string) {
    if (typeof signed !== 'string' || signed.length > 16_384)
      return fail(400, 'bad_request', 'Supply a compact signed statement.')
    const { kid, claims } = this.opts.directory.verifyPartnerJws('production', partner, signed, typ)
    this.checkEnvelope(claims, partner)
    return { kid, claims, signed }
  }
  private checkEnvelope(claims: Record<string, unknown>, issuer: string) {
    const now = Math.floor(this.now() / 1000)
    if (
      claims.iss !== issuer ||
      claims.aud !== this.opts.audience ||
      claims.environment !== 'production' ||
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      claims.iat < 0 ||
      claims.iat > now + 60
    )
      fail(422, 'invalid_claims', 'The signed statement uses an unexpected issuer, environment, audience or time.')
    tokenId(claims.jti)
  }
  attest(worker: Worker, env: PartnerEnvironment, key: string, raw: unknown) {
    const old = this.assignedHandoff(worker, env, key),
      { signedGrant } = fields(raw, ['signedGrant'])
    if (old.signedGrant === signedGrant && old.signedGrant)
      return structuredClone({ ...old.view, state: this.effectiveHandoff(old) })
    if (old.view.state !== 'exchanged') conflict('The partner must exchange the one-use code before attesting.')
    const task = this.currentGrant(old)
    const { kid, claims, signed } = this.verifyEnvelope(worker.partnerId, signedGrant, 'partner-handoff+jwt')
    fields(claims, [
      'iss',
      'aud',
      'jti',
      'iat',
      'handoffId',
      'taskId',
      'termsVersion',
      'termsDigest',
      'environment',
      'actorRef',
      'nonce',
      'exp',
      'grant',
      'grantRef',
      'accountLabel',
    ])
    assertVersion(task, claims)
    if (
      claims.handoffId !== key ||
      claims.taskId !== task.taskId ||
      claims.actorRef !== old.partnerActor ||
      claims.nonce !== old.nonce ||
      !isDeepStrictEqual(claims.grant, old.view.grant) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= Math.floor(this.now() / 1000) ||
      claims.exp * 1000 > Date.parse(old.view.expiresAt) + 999 ||
      Number(claims.iat) >= claims.exp ||
      Number(claims.iat) < Math.floor((Date.parse(old.view.expiresAt) - 300_000) / 1000) - 60
    )
      fail(422, 'invalid_grant', 'The signed grant does not match this handoff.')
    const grantRef = tokenId(claims.grantRef),
      accountLabel = textField(claims.accountLabel, 80)
    const replayKey = scope(worker.partnerId, 'handoff:' + tokenId(claims.jti))
    if (this.db.get('used', replayKey)) conflict('This signed grant was already bound.')
    return this.db.transaction(() => {
      const h = this.db.edit('handoffs', key)
      h.view.accountLabel = accountLabel
      h.view.state = 'attested'
      h.view.expiresAt = iso(Number(claims.exp) * 1000)
      h.signedGrant = signed
      h.grantRef = grantRef
      h.keyId = kid
      this.db.put('used', replayKey, key)
      return h.view
    })
  }
  decideHandoff(actor: WorkActor, env: PartnerEnvironment, key: string, raw: unknown) {
    const view = this.handoff(actor, env, key),
      row = fields(raw, ['decision', 'termsDigest'])
    if (view.termsDigest !== row.termsDigest) conflict('Review the current task terms.')
    const decision = row.decision,
      h = this.handoffRecord(key)
    if (
      (decision === 'confirm' && view.state === 'confirmed') ||
      (decision === 'withdraw' && view.state === 'withdrawn') ||
      (decision === 'decline' && view.state === 'declined')
    )
      return view
    if (decision === 'confirm' && view.state === 'attested') this.currentGrant(h)
    else if (
      !(
        (decision === 'withdraw' && view.state === 'confirmed') ||
        (decision === 'decline' && ['started', 'exchanged', 'attested'].includes(view.state))
      )
    )
      conflict('This decision is unavailable in the current authorization state.')
    return this.db.transaction(() => {
      const live = this.db.edit('handoffs', key)
      live.view.state = decision === 'confirm' ? 'confirmed' : decision === 'withdraw' ? 'withdrawn' : 'declined'
      return live.view
    })
  }
  private dispatch(h: WorkHandoff) {
    const task = this.currentGrant(h),
      partnerId = h.view.partnerId,
      grant = h.view.grant
    const t = this.db.edit('tasks', task.taskId)
    const grantRef = h.grantRef!
    if (grant.kind === 'reserve') {
      const cmd = this.enqueue(
        t,
        partnerId,
        { kind: 'reserve', asset: grant.asset, payerRef: h.partnerActor, grantRef, holdUntil: grant.holdUntil },
        h,
      )
      t.reserveCommand = cmd.commandId
      t.funding = 'reserving'
      t.pinned[partnerId] = this.freezePartner(this.opts.directory.publicProfile(partnerId))
    } else if (grant.kind === 'receive') {
      const cmd = this.enqueue(
        t,
        partnerId,
        {
          kind: 'release',
          reservationId: t.reservationId!,
          asset: grant.asset,
          beneficiaryRef: h.partnerActor,
          grantRef,
          submissionId: t.winnerId!,
        },
        h,
      )
      t.payoutCommand = cmd.commandId
      t.funding = 'delivering'
      this.markObligation(t, cmd, 'settlement_pending')
    } else {
      const s = this.addSubmission(t, h.owner)
      this.enqueue(
        t,
        partnerId,
        {
          kind: 'run',
          input: t.input,
          grantRef,
          submissionId: s.submissionId,
          model: grant.model,
          ...(grant.effort !== undefined && { effort: grant.effort }),
          maxInputTokens: grant.maxInputTokens,
          maxOutputTokens: grant.maxOutputTokens,
        },
        h,
      )
    }
    this.db.edit('handoffs', h.view.handoffId).view.state = 'consumed'
  }
  private canDeliver(c: WorkCommand) {
    if (c.view.state !== 'requested' || Date.parse(c.view.deadline) <= this.now()) return false
    const t = this.task(c.view.taskId)
    if (this.db.all('obligations').some((o) => o.commandId === c.view.commandId && o.state === 'in_recovery'))
      return false
    if (c.handoffId) {
      const h = this.handoffRecord(c.handoffId)
      if (this.opts.canAccessProject?.(h.actor, t.projectId) === false) return false
    }
    try {
      if (c.view.action.kind === 'return' || c.view.action.kind === 'release') {
        const issuer = this.opts.directory.publicProfile(c.view.partnerId),
          recorded = t.pinned[c.view.partnerId]
        if (
          !recorded ||
          issuer.status !== 'active' ||
          issuer.identity.domainAscii !== recorded.domainAscii ||
          issuer.identity.identityRevision !== recorded.identityRevision
        )
          return false
        const enrollment = this.opts.directory.machineEnrollment('production', c.view.partnerId)
        const { asset } = c.view.action
        if (
          !enrollment.capabilities.includes('custodian') ||
          !enrollment.catalog.assets.some((a) => a.assetId === asset.assetId && a.unit === asset.unit)
        )
          return false
      } else {
        this.checkBindings(t)
        assertTermsAvailable(this.opts.directory, t.terms)
      }
      return true
    } catch (e) {
      if (isIneligible(e)) return false
      throw e
    }
  }
  commands(worker: Worker, env: PartnerEnvironment) {
    prod(env)
    this.opts.directory.machineEnrollment(env, worker.partnerId)
    for (const h of this.db.all('handoffs')) {
      if (h.view.partnerId !== worker.partnerId || this.effectiveHandoff(h) !== 'confirmed') continue
      // One stale confirmation must not starve other users of the same provider.
      try {
        this.db.transaction(() => this.dispatch(h))
      } catch (e) {
        if (!isIneligible(e)) throw e
      }
    }
    return this.db
      .all('commands')
      .filter((c) => c.view.partnerId === worker.partnerId && this.canDeliver(c))
      .map((c) => structuredClone(c.view))
  }
  private assigned(worker: Worker, env: PartnerEnvironment, commandId: string) {
    prod(env)
    const c = this.db.get('commands', commandId)
    if (!c || c.view.partnerId !== worker.partnerId) return missing()
    return c
  }
  command(worker: Worker, env: PartnerEnvironment, key: string) {
    const command = this.assigned(worker, env, key)
    if (command.view.state === 'requested' && !this.canDeliver(command))
      conflict('This operation is unavailable for dispatch.')
    return structuredClone(command.view)
  }
  upload(
    worker: Worker,
    env: PartnerEnvironment,
    key: string,
    contentType: string,
    bytes: Uint8Array,
    expectedDigest: string,
  ) {
    const c = this.assigned(worker, env, key)
    if (c.view.action.kind !== 'run' || !this.canDeliver(c))
      fail(403, 'forbidden', 'Only the assigned active run can upload its result.')
    if (bytes.byteLength > 8 * 1024 * 1024) fail(413, 'too_large', 'The artifact exceeds eight MiB.')
    if (!uploadTypes.has(contentType)) fail(415, 'unsupported_media_type', 'Choose an approved artifact media type.')
    if (hash(bytes) !== digest(expectedDigest))
      fail(422, 'digest_mismatch', 'The bytes differ from the supplied digest.')
    const existing = this.db.all('artifacts').filter((a) => a.uploadedFor === key)
    if (existing.some((a) => a.ref.digest !== expectedDigest || a.ref.mediaType !== contentType))
      conflict('This command already has an immutable output. Reuse its original upload.')
    return this.db.transaction(() => this.putArtifact(bytes, contentType, key))
  }
  artifact(worker: Worker, env: PartnerEnvironment, key: string, artifactId: string) {
    const c = this.assigned(worker, env, key)
    if (c.view.state !== 'requested' || !this.canDeliver(c)) missing()
    const ref = protectedCommandInput(c.view.action).find((a) => a.artifactId === artifactId)
    const blob = this.db.get('artifacts', artifactId)
    if (!ref || !blob || !isDeepStrictEqual(ref, blob.ref)) return missing()
    const bytes = Buffer.from(blob.bytes, 'base64')
    if (hash(bytes) !== ref.digest) fail(503, 'artifact_unavailable', 'Stored bytes failed integrity verification.')
    return { contentType: ref.mediaType, digest: ref.digest, bytes }
  }
  submissionOutput(
    actor: WorkActor,
    projectId: string,
    taskId: string,
    submissionId: string,
    query: { offset?: unknown; length?: unknown } = {},
  ) {
    const task = this.visible(actor, projectId, taskId)
    const submission = task.submissions.find((s) => s.submissionId === submissionId)
    if (!submission?.artifact) return missing()
    const blob = this.db.get('artifacts', submission.artifact.artifactId)
    if (!blob || !isDeepStrictEqual(blob.ref, submission.artifact)) return missing()
    const offset = Number(query.offset ?? 0),
      length = Number(query.length ?? 65_536)
    const bytes = Buffer.from(blob.bytes, 'base64')
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 65_536 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > bytes.length
    )
      return fail(400, 'bad_request', 'Use a byte offset within this artifact and a chunk of 1–65536 bytes.')
    const end = Math.min(offset + length, bytes.length)
    return {
      artifact: structuredClone(blob.ref),
      byteLength: bytes.length,
      offset,
      dataBase64: Buffer.from(bytes.subarray(offset, end)).toString('base64'),
      ...(end < bytes.length && { nextOffset: end }),
    }
  }
  /** Expiration withdraws availability. An external effect whose receipt never
   * arrived remains an obligation; it cannot be retried as a fresh command. */
  maintain() {
    const now = this.now()
    return this.db.transaction(() => {
      let count = 0
      for (const { view: c } of this.db.all('commands')) {
        if (c.state !== 'requested' || Date.parse(c.deadline) > now) continue
        if (this.db.all('obligations').some((o) => o.commandId === c.commandId && o.state === 'in_recovery')) continue
        const live = this.db.edit('commands', c.commandId).view
        live.state = 'uncertain'
        const t = this.db.edit('tasks', c.taskId)
        if (c.action.kind === 'reserve' || c.action.kind === 'release' || c.action.kind === 'return')
          t.funding = 'uncertain'
        this.markObligation(t, live, 'effect_uncertain')
        count++
      }
      for (const task of this.db.all('tasks')) {
        if (
          (task.status !== 'draft' && task.status !== 'published') ||
          !task.terms.deadline ||
          Date.parse(task.terms.deadline) > now ||
          task.winnerId ||
          this.recoveryOpen(task) ||
          ['uncertain', 'reserving'].includes(task.funding) ||
          task.submissions.some((s) => s.verdict === 'pending' || s.provenance === 'pending')
        )
          continue
        const t = this.db.edit('tasks', task.taskId)
        t.status = t.publishedAt ? 'closed' : 'cancelled'
        if (t.funding === 'held') this.returnHold(t)
        count++
      }
      for (const a of this.db.all('artifacts')) {
        if (!a.uploadedFor || now - a.created < 86_400_000) continue
        const cmd = this.db.get('commands', a.uploadedFor)
        if (cmd?.view.state === 'failed') {
          this.db.remove('artifacts', a.ref.artifactId)
          count++
        }
      }
      return count
    })
  }
  private applyOutcome(command: TaskPartnerCommand, outcome: VerifiedOutcome) {
    const t = this.db.edit('tasks', command.taskId),
      action = command.action
    const lookup = (submissionId: string) => t.submissions.find((s) => s.submissionId === submissionId) ?? missing()
    if (outcome.kind === 'unknown') {
      if (action.kind === 'reserve' || action.kind === 'release' || action.kind === 'return') t.funding = 'uncertain'
      this.markObligation(t, command, 'effect_uncertain')
      return
    }
    if (outcome.kind === 'failed') {
      if (action.kind === 'reserve') {
        t.funding = 'awaiting'
        delete t.reserveCommand
        this.markObligation(t, command, 'closed')
        delete t.obligationId
      } else if (action.kind === 'release' || action.kind === 'return') {
        // Keep the original entitlement and hold intact for operations staff.
        t.funding = 'held'
        this.markObligation(t, command, 'held')
      } else {
        const submission = lookup(action.submissionId)
        if (action.kind === 'run') submission.provenance = 'failed'
        if (submission.verdict === 'pending') submission.verdict = 'unavailable'
        if (this.db.get('obligations', command.commandId)) this.markObligation(t, command, 'closed')
      }
      return
    }
    switch (outcome.kind) {
      case 'reserve': {
        const key = scope(command.partnerId, 'reservation:' + outcome.reservationId)
        if (this.db.get('used', key)) conflict('This reservation is already assigned to an operation.')
        this.db.put('used', key, command.commandId)
        t.reservationId = outcome.reservationId
        t.funding = 'held'
        this.markObligation(t, command, 'held')
        break
      }
      case 'run': {
        const key = scope(command.partnerId, 'run:' + outcome.providerRunId)
        if (this.db.get('used', key)) conflict('This provider run is already attributed.')
        const blob = this.db.get('artifacts', outcome.output.artifactId)
        if (!blob || blob.uploadedFor !== command.commandId || !isDeepStrictEqual(blob.ref, outcome.output))
          return fail(
            422,
            'artifact_mismatch',
            'The attested output is not the immutable output uploaded for this run.',
          )
        this.db.put('used', key, command.commandId)
        const s = lookup(outcome.submissionId)
        s.provenance = 'attested'
        if (blob.ref.mediaType === 'text/plain')
          s.text = Buffer.from(blob.bytes, 'base64').toString('utf8').slice(0, 16_384)
        this.evaluate(t, s, blob.ref)
        if (this.db.get('obligations', command.commandId)) this.markObligation(t, command, 'closed')
        break
      }
      case 'verify': {
        const s = lookup(outcome.submissionId)
        s.verdict = outcome.verdict
        this.chooseWinner(t, s)
        if (this.db.get('obligations', command.commandId)) this.markObligation(t, command, 'closed')
        break
      }
      case 'release':
      case 'return': {
        if (
          t.payoutCommand !== command.commandId ||
          t.reservationId !== outcome.reservationId ||
          !['returning', 'delivering', 'uncertain', 'held'].includes(t.funding)
        )
          conflict('The reservation is unavailable for this disposition.')
        const key = scope(command.partnerId, 'transfer:' + outcome.transferRef)
        if (this.db.get('used', key)) conflict('This transfer has already settled an operation.')
        this.db.put('used', key, command.commandId)
        t.funding = outcome.kind === 'release' ? 'delivered' : 'returned'
        this.markObligation(t, command, 'closed')
        break
      }
    }
  }
  private bindEvidence(c: TaskPartnerCommand, claims: Record<string, unknown>) {
    assertVersion(c, claims)
    if (
      claims.commandId !== c.commandId ||
      claims.taskId !== c.taskId ||
      Number(claims.iat) * 1000 < Date.parse(c.issuedAt) - 60_000
    )
      fail(422, 'receipt_mismatch', 'The statement predates or references a different command.')
    return validatePartnerOutcome(c.action, claims.outcome)
  }
  private validateReconciliation(c: TaskPartnerCommand, recovery: WorkRecovery, outcome: VerifiedOutcome) {
    if (outcome.kind === 'unknown') conflict('Reconciliation requires a definitive external outcome.')
    // A lookup of an already-recorded hold confirms its original identifier.
    // It must never allocate another hold, clear an award or replay a transfer.
    const reaffirm = c.state === 'succeeded' && c.action.kind === 'reserve' && recovery?.mode === 'lookup'
    if (
      c.state === 'succeeded' &&
      (!reaffirm || outcome.kind !== 'reserve' || outcome.reservationId !== this.task(c.taskId).reservationId)
    )
      conflict('The recovery evidence conflicts with the recorded terminal outcome.')
    if (c.state === 'failed' && outcome.kind !== 'failed' && recovery?.mode !== c.action.kind)
      conflict('A new disposition requires explicit authorization for the original command.')
    return reaffirm
  }
  private settle(
    c: TaskPartnerCommand,
    claims: Record<string, unknown>,
    signed: string,
    keyId: string,
    recovery?: WorkRecovery,
  ) {
    if (!recovery && (c.state === 'succeeded' || c.state === 'failed'))
      conflict('This command already has a terminal outcome.')
    const jti = tokenId(claims.jti),
      replayKey = scope(c.partnerId, jti)
    if (this.db.get('receipts', replayKey)) conflict('This receipt identifier already records different evidence.')
    const outcome = this.bindEvidence(c, claims)
    const reaffirm = recovery ? this.validateReconciliation(c, recovery, outcome) : false
    const state = outcome.kind === 'failed' ? 'failed' : outcome.kind === 'unknown' ? 'uncertain' : 'succeeded'
    const command = this.db.edit('commands', c.commandId).view
    command.state = state
    command.receiptId = jti
    if (reaffirm) this.markObligation(this.db.edit('tasks', c.taskId), command, 'held')
    else this.applyOutcome(command, outcome)
    const evidence: StoredReceipt = { commandId: c.commandId, receiptId: jti, keyId, signedReceipt: signed, state }
    this.db.put('receipts', replayKey, evidence)
    this.db.put('used', scope(c.partnerId, 'signed:' + hash(signed)), replayKey)
    return { receiptId: jti, commandId: c.commandId, state }
  }
  receipt(worker: Worker, env: PartnerEnvironment, key: string, raw: unknown) {
    const c = this.assigned(worker, env, key).view,
      { signedReceipt } = fields(raw, ['signedReceipt'])
    if (typeof signedReceipt !== 'string' || signedReceipt.length > 16_384)
      return fail(400, 'bad_request', 'Supply a signed receipt.')
    const priorKey = this.db.get('used', scope(worker.partnerId, 'signed:' + hash(signedReceipt)))
    if (priorKey) {
      const p = this.db.get('receipts', priorKey)
      if (!p || p.commandId !== key || p.signedReceipt !== signedReceipt)
        return conflict('The signed receipt belongs to a different command.')
      return { receiptId: p.receiptId, commandId: p.commandId, state: p.state }
    }
    if (this.db.all('obligations').some((o) => o.commandId === key && o.state === 'in_recovery'))
      conflict('Recovery is in progress. Submit evidence through the active case.')
    const { kid, claims, signed } = this.verifyEnvelope(worker.partnerId, signedReceipt, 'partner-receipt+jwt')
    fields(claims, [
      'iss',
      'aud',
      'jti',
      'iat',
      'environment',
      'commandId',
      'taskId',
      'termsVersion',
      'termsDigest',
      'outcome',
    ])
    return this.db.transaction(() => this.settle(c, claims, signed, kid))
  }
  private freezePartner(profile: PartnerPublicProfile) {
    const {
      partnerId,
      displayName,
      identity: { domainAscii, identityRevision, profilePath },
    } = profile
    return { partnerId, displayName, domainAscii, identityRevision, profilePath }
  }
  private balanceFor(account: string) {
    let available = 0n,
      held = 0n
    for (const entry of this.db.all('creditEntries')) {
      const quantity = BigInt(entry.amount)
      if (entry.kind === 'issue' && entry.account === account) available += quantity
      if (entry.kind === 'reserve' && entry.account === account) {
        available -= quantity
        held += quantity
      }
      if (entry.kind === 'release' || entry.kind === 'return') {
        if (entry.source === account) held -= quantity
        if (entry.account === account) available += quantity
      }
    }
    return { ...SITE_WORK_CREDIT, available: available.toString(), held: held.toString() }
  }
  balance(actor: WorkActor) {
    return this.balanceFor(actorRef(actor))
  }
  issueCredits(operator: WorkActor, recipient: WorkActor, raw: unknown) {
    if (!operator.operator) fail(403, 'forbidden', 'Only the site issuer may grant work credits.')
    if (!this.opts.audience)
      fail(503, 'deployment_unconfigured', 'Configure the deployment origin before issuing credits.')
    const row = fields(raw, ['quantity', 'reference', 'reason']),
      account = actorRef(recipient),
      issuer = actorRef(operator)
    const reference = 'issue:' + tokenId(row.reference),
      reason = textField(row.reason, 300)
    const quantity = row.quantity
    if (typeof quantity !== 'string' || !/^[1-9][0-9]{0,37}$/.test(quantity))
      return fail(400, 'bad_request', 'Use a positive whole credit quantity.')
    const prior = this.db.get('creditEntries', reference)
    if (prior) {
      if (prior.account !== account || prior.amount !== quantity || prior.reason !== reason || prior.issuer !== issuer)
        conflict('This issuance reference already identifies a different grant.')
      return this.balanceFor(account)
    }
    return this.db.transaction(() => {
      this.db.put('creditEntries', reference, {
        reference,
        kind: 'issue',
        amount: quantity,
        account,
        issuer,
        reason,
        at: iso(this.now()),
      })
      return this.balanceFor(account)
    })
  }
  fundFromBalance(actor: WorkActor, projectId: string, taskId: string, raw: unknown) {
    const old = this.visible(actor, projectId, taskId),
      row = fields(raw, ['termsVersion', 'termsDigest'])
    this.owner(actor, old)
    assertVersion(old, row)
    if (old.terms.reward?.partnerId !== SITE_CUSTODIAN_ID || old.status !== 'draft')
      return conflict('Choose an Agent Commons work-credit reward on a draft first.')
    if (old.funding === 'held') return this.expose(actor, old)
    assertTermsAvailable(this.opts.directory, old.terms)
    this.checkDeadline(old)
    const { asset, holdUntil } = old.terms.reward
    if (BigInt(this.balance(actor).available) < BigInt(asset.quantity))
      conflict('Your available work-credit balance does not cover this reward.')
    return this.db.transaction(() => {
      const t = this.db.edit('tasks', taskId)
      const command = this.enqueue(t, SITE_CUSTODIAN_ID, {
        kind: 'reserve',
        asset,
        holdUntil,
        payerRef: t.owner,
        grantRef: id('authorization'),
      })
      this.db.put('creditEntries', command.commandId, {
        reference: command.commandId,
        kind: 'reserve',
        account: t.owner,
        amount: asset.quantity,
        ...version(t),
        at: iso(this.now()),
      })
      const outcome = validatePartnerOutcome(command.action, { ...command.action, reservationId: id('hold') })
      command.state = 'succeeded'
      command.receiptId = command.commandId
      t.reserveCommand = command.commandId
      this.applyOutcome(command, outcome)
      return this.expose(actor, this.task(taskId))
    })
  }
  private settleSiteHold(task: WorkTask, winner?: WorkSubmission) {
    const reward = task.terms.reward!
    if (!task.reservationId || task.funding !== 'held' || task.payoutCommand)
      return conflict('This site-held reward is already committed.')
    const action: Extract<TaskAction, { kind: 'release' | 'return' }> = winner
      ? {
          kind: 'release',
          reservationId: task.reservationId,
          asset: reward.asset,
          beneficiaryRef: winner.author,
          submissionId: winner.submissionId,
          grantRef: task.reserveCommand!,
        }
      : { kind: 'return', reservationId: task.reservationId, asset: reward.asset, payerRef: task.owner }
    const cmd = this.enqueue(task, SITE_CUSTODIAN_ID, action),
      account = winner?.author ?? task.owner
    this.db.put('creditEntries', cmd.commandId, {
      reference: cmd.commandId,
      kind: action.kind,
      account,
      source: task.owner,
      amount: reward.asset.quantity,
      ...version(task),
      at: iso(this.now()),
    })
    const outcome = validatePartnerOutcome(action, { ...action, transferRef: cmd.commandId })
    cmd.state = 'succeeded'
    cmd.receiptId = cmd.commandId
    task.payoutCommand = cmd.commandId
    task.funding = winner ? 'delivering' : 'returning'
    this.applyOutcome(cmd, outcome)
    // applyOutcome edits the task row in its own before-image. Keep the
    // ongoing synchronous caller's projection consistent with the journal.
    task.funding = winner ? 'delivered' : 'returned'
  }
  obligations(actor: WorkActor, env: PartnerEnvironment) {
    prod(env)
    if (!actor.operator) fail(403, 'forbidden', 'Settlement operator access is required.')
    return structuredClone(this.db.all('obligations'))
  }
  private publicRecovery(actor: WorkActor, r: WorkRecovery) {
    const { opener, authorizer, submitter, sourceReference, externalEvidence, keyId, ...view } = r
    const availableActions: Array<'authorize' | 'submit_evidence' | 'confirm_evidence'> = []
    const obligation = this.db.get('obligations', r.obligationId)
    if (
      actor.operator &&
      actor.freshAuth &&
      actor.recoveryRole &&
      obligation?.state === 'in_recovery' &&
      obligation.latestRecoveryId === r.recoveryId
    ) {
      const who = actorRef(actor)
      if (r.state === 'opened' && actor.recoveryRole === 'settlement' && who !== r.opener)
        availableActions.push('authorize')
      if (r.state === 'authorized') availableActions.push('submit_evidence')
      if (r.state === 'evidence_recorded' && actor.recoveryRole === 'settlement' && who !== r.submitter)
        availableActions.push('confirm_evidence')
    }
    return structuredClone({ ...view, availableActions })
  }
  recovery(actor: WorkActor, env: PartnerEnvironment, obligationId: string, recoveryId: string) {
    prod(env)
    if (!actor.operator) fail(403, 'forbidden', 'An operator is required.')
    const r = this.db.get('recoveries', recoveryId)
    if (!r || r.obligationId !== obligationId) return missing()
    return this.publicRecovery(actor, r)
  }
  private recoveryEvidence(c: TaskPartnerCommand, r: WorkRecovery, signed: string, expectedDigest: unknown) {
    if (!this.opts.verifyRecovery)
      return fail(503, 'recovery_unavailable', 'An independent recovery signing authority is required.')
    if (hash(signed) !== digest(expectedDigest))
      return fail(422, 'digest_mismatch', 'The archived recovery evidence has a different digest.')
    const verified = this.opts.verifyRecovery('production', c.partnerId, signed)
    const claims = fields(verified.claims, [
      'iss',
      'aud',
      'jti',
      'iat',
      'environment',
      'commandId',
      'taskId',
      'termsVersion',
      'termsDigest',
      'outcome',
      'recoveryId',
    ])
    this.checkEnvelope(claims, c.partnerId)
    if (claims.recoveryId !== r.recoveryId)
      return fail(422, 'receipt_mismatch', 'The evidence belongs to another recovery case.')
    this.validateReconciliation(c, r, this.bindEvidence(c, claims))
    if (this.db.get('receipts', scope(c.partnerId, tokenId(claims.jti))))
      conflict('This receipt identifier already records different evidence.')
    return verified
  }
  recover(actor: WorkActor, env: PartnerEnvironment, obligationId: string, raw: unknown) {
    prod(env)
    if (!actor.operator || !actor.freshAuth || !actor.recoveryRole)
      fail(403, 'forbidden', 'Fresh recovery-operator authentication is required.')
    const who = actorRef(actor),
      row = record(raw),
      old = this.db.get('obligations', obligationId) ?? missing()
    if (old.state === 'closed') conflict('This obligation is closed.')
    const cmd = this.db.get('commands', old.commandId)?.view ?? missing()
    if (cmd.partnerId === SITE_CUSTODIAN_ID) conflict('Site-issued work credits use the internal ledger.')
    if (row.action === 'open') {
      fields(row, ['action', 'commandId', 'expectedRevision', 'mode', 'reason'])
      if (actor.recoveryRole !== 'incident') fail(403, 'forbidden', 'An incident operator must open the case.')
      if (row.commandId !== old.commandId || row.expectedRevision !== old.revision || old.state === 'in_recovery')
        conflict('Review the latest obligation.')
      if (row.mode !== 'lookup' && row.mode !== 'release' && row.mode !== 'return')
        fail(400, 'bad_request', 'Choose a supported recovery mode.')
      if (row.mode !== 'lookup' && row.mode !== cmd.action.kind)
        conflict('Recovery can only transmit the previously authorized disposition.')
      const reason = textField(row.reason, 300),
        mode = row.mode
      return this.db.transaction(() => {
        const r: WorkRecovery = {
          recoveryId: id('recovery'),
          obligationId,
          commandId: cmd.commandId,
          revision: 1,
          state: 'opened',
          mode,
          reason,
          opener: who,
        }
        this.db.put('recoveries', r.recoveryId, r)
        const o = this.db.edit('obligations', obligationId)
        o.state = 'in_recovery'
        o.latestRecoveryId = r.recoveryId
        o.revision++
        return this.publicRecovery(actor, r)
      })
    }
    const recoveryId = tokenId(row.recoveryId),
      found = this.db.get('recoveries', recoveryId)
    if (!found || found.obligationId !== obligationId || old.latestRecoveryId !== recoveryId) return missing()
    if (row.expectedRevision !== found.revision || old.state !== 'in_recovery')
      conflict('Review the latest recovery case.')
    return this.db.transaction(() => {
      const r = this.db.edit('recoveries', recoveryId)
      if (row.action === 'authorize') {
        fields(row, ['action', 'recoveryId', 'expectedRevision'])
        if (actor.recoveryRole !== 'settlement' || who === r.opener)
          fail(403, 'forbidden', 'A distinct settlement operator must authorize recovery.')
        if (r.state !== 'opened') conflict('The case is not awaiting authorization.')
        const t = this.task(cmd.taskId)
        if (
          (r.mode === 'release' &&
            (cmd.action.kind !== 'release' ||
              t.payoutCommand !== cmd.commandId ||
              t.winnerId !== cmd.action.submissionId)) ||
          (r.mode === 'return' && (cmd.action.kind !== 'return' || t.payoutCommand !== cmd.commandId || t.winnerId))
        )
          conflict('The original settlement is no longer eligible.')
        r.authorizer = who
        r.state = 'authorized'
      } else if (row.action === 'submit_evidence') {
        fields(row, [
          'action',
          'recoveryId',
          'expectedRevision',
          'sourceReference',
          'externalEvidence',
          'evidenceDigest',
        ])
        if (r.state !== 'authorized') conflict('Authorize this case before attaching external evidence.')
        const signed = textField(row.externalEvidence, 16_384),
          verified = this.recoveryEvidence(cmd, r, signed, row.evidenceDigest)
        r.keyId = verified.kid
        r.submitter = who
        r.sourceReference = textField(row.sourceReference, 160)
        r.externalEvidence = signed
        r.evidenceDigest = digest(row.evidenceDigest)
        r.state = 'evidence_recorded'
      } else if (row.action === 'confirm_evidence') {
        fields(row, ['action', 'recoveryId', 'expectedRevision', 'evidenceDigest'])
        if (actor.recoveryRole !== 'settlement' || who === r.submitter)
          fail(403, 'forbidden', 'A distinct settlement operator must confirm the evidence.')
        if (r.state !== 'evidence_recorded' || row.evidenceDigest !== r.evidenceDigest)
          conflict('Review the exact signed evidence before confirming.')
        const signed = r.externalEvidence!,
          verified = this.recoveryEvidence(cmd, r, signed, row.evidenceDigest)
        this.settle(cmd, verified.claims, signed, verified.kid, r)
        r.state = 'reconciled'
      } else fail(400, 'bad_request', 'Choose a supported recovery action.')
      r.revision++
      return this.publicRecovery(actor, r)
    })
  }
}
function isIneligible(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    Number(error.status) >= 400 &&
    Number(error.status) < 500
  )
}
