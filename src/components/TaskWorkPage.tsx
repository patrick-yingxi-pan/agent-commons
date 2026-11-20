import { Fragment, useEffect, useState } from 'react'
import { partnerCollisionLabel } from '../../contract/taskPartners'
import type { PartnerTaskView } from '../../contract/taskPartnerWork'
import {
  useMe,
  usePartnerCatalog,
  usePartnerTask,
  usePartnerTasks,
  useTaskHandoff,
  usePartnerBalance,
  refreshPartnerTask,
  refreshPartnerWork,
  refreshHandoffStatus,
} from '../api/hooks'
import {
  downloadPartnerOutput,
  actOnPartnerTask,
  createPartnerTask,
  decideTaskHandoff,
  fundPartnerTask,
  revisePartnerTask,
  savePartnerTask,
  startTaskHandoff,
} from '../api/commands'
import { usePartnerAction } from '../controller/usePartnerAction'
import { useRelations } from '../controller/useRelations'
import { AtomicResourcePage, ResourcePageHeader } from './ResourcePage'
import {
  PartnerField,
  PartnerProfileName,
  PartnerPagination,
  PartnerGroup,
  PartnerNotice,
  PartnerQueryStatus,
} from './PartnerFields'
import TaskTermsEditor from './TaskTermsEditor'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { apiNavigationHref } from '../api/client'
import { partnerPaths as paths } from '../api/partnerPaths'

export function TaskWorkList({ projectId }: { projectId: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const tasks = usePartnerTasks(projectId, cursors.at(-1))
  const drafts = tasks.data?.items.filter((t) => t.requester && !t.publishedAt && t.status === 'draft')
  const [editing, setEditing] = useState(false)
  const action = usePartnerAction()
  const rel = useRelations()
  return (
    <section className="mt-4 min-w-0 space-y-2 border-t border-line pt-3" aria-label="Your task drafts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Your task drafts</h3>
        {!editing && (
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => setEditing(true)}
          >
            Create task offer
          </button>
        )}
      </div>
      {editing && (
        <TaskTermsEditor
          pending={action.pending}
          onClose={() => setEditing(false)}
          onSave={(terms) =>
            void action.run(
              ['create', projectId, terms],
              (k) => createPartnerTask(projectId, terms, k),
              (r) => {
                setEditing(false)
                rel.navigate('projects', projectId, r.taskId)
              },
            )
          }
        />
      )}
      <PartnerNotice action={action} />
      <PartnerQueryStatus query={tasks} retry={() => refreshPartnerWork(projectId)} />
      {drafts?.map((t) => (
        <button
          key={t.taskId}
          className="block w-full border-t border-line py-2 text-left text-[13px]"
          onClick={() => rel.navigate('projects', projectId, t.taskId)}
        >
          <span className="block line-clamp-2 font-medium">{t.terms.description}</span>
          <span className="text-ink-faint">
            {t.status === 'draft' ? 'Private draft' : t.status} ·{' '}
            {t.terms.reward ? t.terms.reward.asset.quantity + ' ' + t.terms.reward.asset.unit : 'Volunteer'}
          </span>
        </button>
      ))}
      <PartnerPagination next={tasks.data?.nextCursor} cursors={cursors} set={setCursors} />
      {drafts?.length === 0 && (
        <p className="text-[13px] text-ink-faint">
          Offer volunteer work or reserve a reward for a verified result.
        </p>
      )}
    </section>
  )
}
function Issuer({ task, id }: { task: PartnerTaskView; id: string }) {
  if (id === 'agent-commons') return <strong className="block">Agent Commons</strong>
  return <PartnerIssuer task={task} id={id} />
}
function PartnerIssuer({ task, id }: { task: PartnerTaskView; id: string }) {
  const { data } = usePartnerCatalog({ partnerId: id })
  const frozen = task.partners.find((p) => p.partnerId === id)
  const live = data?.items.find((p) => p.partnerId === id)
  if (!frozen && !live) return <span className="block break-all">Partner {id}</span>
  const name = frozen?.displayName ?? live!.displayName
  const identity = frozen ?? live!.identity
  return (
    <span className="block break-words">
      <PartnerProfileName name={name} domain={identity.domainAscii} path={identity.profilePath} origin={data?.webOrigin} />
      <span className="block break-all font-mono text-[13px]">
        <bdi dir="ltr">{identity.domainAscii}</bdi>
      </span>
      {(frozen?.demo || live?.demo) && <span className="block text-[13px] text-ink-faint">Demo organization</span>}
      {frozen && frozen.status !== 'active' && (
        <span>Current status · {frozen.status.replaceAll('_', ' ')}</span>
      )}
    </span>
  )
}
function AccountHandoff({
  task,
  id,
  purpose,
}: {
  task: PartnerTaskView
  id: string
  purpose: 'reserve' | 'run' | 'receive'
}) {
  const me = useMe().data
  const labels = {
    reserve: 'Reserve the reward',
    run: 'Authorize a model run',
    receive: 'Choose a payout account',
  }
  const action = usePartnerAction()
  const [known, setKnown] = useState('')
  const catalogue = usePartnerCatalog({ partnerId: id })
  const partner = catalogue.data?.items.find((p) => p.partnerId === id)
  const cacheKey = me
    ? ['partner-handoff', me.user.id, me.tenant.id, task.taskId, task.termsVersion, purpose, id].join('/')
    : null
  const [handoffId, setHandoffId] = useState<string | null>(null)
  useEffect(() => {
    setKnown('')
    setHandoffId(cacheKey ? sessionStorage.getItem(cacheKey) : null)
  }, [cacheKey])
  const result = useTaskHandoff(handoffId)
  const current = result.data
  useEffect(() => {
    if (current?.state === 'consumed') refreshPartnerTask(task.projectId, task.taskId)
  }, [current?.state, task.projectId, task.taskId])
  useEffect(() => {
    if (!handoffId || ['expired', 'declined', 'withdrawn', 'consumed'].includes(current?.state ?? '')) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshHandoffStatus(handoffId)
    }, 7000)
    const refresh = () => refreshHandoffStatus(handoffId)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [handoffId, current?.state])
  const reset = () => {
    if (cacheKey) sessionStorage.removeItem(cacheKey)
    setHandoffId(null)
    setKnown('')
  }
  const decide = (decision: 'confirm' | 'decline' | 'withdraw') => {
    if (!handoffId) return
    void action.run(
      [decision, handoffId, task.termsDigest],
      (k) => decideTaskHandoff(task, handoffId, decision, k),
      () => {
        refreshHandoffStatus(handoffId)
        action.setNotice(
          decision === 'confirm'
            ? 'Account confirmed. Check task status for the result.'
            : 'Authorization updated.',
        )
      },
    )
  }
  const bound =
    current &&
    current.partnerId === id &&
    current.taskId === task.taskId &&
    current.termsDigest === task.termsDigest
  return (
    <PartnerGroup title={labels[purpose]}>
      {!handoffId && (
        <>
          <p className="text-[13px]">
            You will sign in on the partner’s website and confirm the selected account here.
          </p>
          <PartnerQueryStatus query={catalogue} retry={() => refreshPartnerWork(task.projectId)} />
          {partner ? (
            <>
              <p>
                <strong>
                  <bdi>{partner.displayName}</bdi>
                </strong>
                <br />
                <bdi dir="ltr" className="break-all font-mono">
                  {partner.identity.domainAscii}
                </bdi>
                {partner.demo && <span className="block text-[13px] text-ink-faint">Demo organization</span>}
              </p>
              {partner.identity.collisionSignals.length > 0 && <p>{partnerCollisionLabel(partner.identity.collisionSignals)}</p>}
              {!partner.trustedForActor && (
                <PartnerField
                  label="Independently known website domain"
                  value={known}
                  onChange={(e) => setKnown(e.target.value)}
                  hint={
                    partner.identity.collisionSignals.length
                      ? 'Enter the domain from your own supplier records.'
                      : 'Optional unless your previously trusted domain changed. Use a domain you obtained independently.'
                  }
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              )}
              <button
                className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
                disabled={
                  action.pending ||
                  !cacheKey ||
                  (partner.identity.collisionSignals.length > 0 && !partner.trustedForActor && !known.trim())
                }
                onClick={() => {
                  const body = {
                    taskId: task.taskId,
                    termsVersion: task.termsVersion,
                    termsDigest: task.termsDigest,
                    partnerId: id,
                    purpose,
                    ...(known.trim()
                      ? {
                          expectedIdentity: {
                            domainAscii: known.trim().toLowerCase(),
                            identityRevision: partner.identity.identityRevision,
                          },
                        }
                      : {}),
                  }
                  void action.run(
                    body,
                    (k) => startTaskHandoff(body, k),
                    (r) => {
                      if (cacheKey) sessionStorage.setItem(cacheKey, r.handoffId)
                      setHandoffId(r.handoffId)
                    },
                  )
                }}
              >
                Review partner authorization
              </button>
            </>
          ) : (
            catalogue.data && <p>The required partner is currently unavailable.</p>
          )}
        </>
      )}
      {handoffId && (
        <>
          <PartnerQueryStatus query={result} retry={() => refreshHandoffStatus(handoffId)} />
          {bound && (
            <>
              <p className="text-[13px]">Authorization · {current.state}</p>
              {current.grant.kind === 'run' ? (
                <p>
                  {current.grant.model} · up to {current.grant.maxInputTokens} input and{' '}
                  {current.grant.maxOutputTokens} output tokens.
                </p>
              ) : (
                <p>
                  {current.grant.asset.quantity} {current.grant.asset.unit} · {current.grant.asset.assetId}
                </p>
              )}
              <p className="break-all text-[13px]">Verified website · <bdi dir="ltr">{current.identity.domainAscii}</bdi></p>
              {current.demo && <p className="text-[13px] text-ink-faint">Demo organization</p>}
              {current.identity.collisionSignals.length > 0 && <p>{partnerCollisionLabel(current.identity.collisionSignals)}</p>}
              {current.state === 'started' && (
                <a className={PAGE_ACTION_BUTTON_CLASS} href={apiNavigationHref(paths.partnerContinue(current.handoffId))}
                  target="_blank" rel="noopener noreferrer">Continue to partner · <bdi dir="ltr">{current.handoffDomainAscii}</bdi></a>
              )}
              {current.state === 'attested' && (
                <>
                  <p>Selected account · {current.accountLabel}</p>
                  <button
                    className={PAGE_ACTION_BUTTON_CLASS}
                    disabled={action.pending}
                    onClick={() => decide('confirm')}
                  >
                    Confirm account and terms
                  </button>
                </>
              )}
              {['started', 'exchanged', 'attested'].includes(current.state) && (
                <button
                  className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
                  disabled={action.pending}
                  onClick={() => decide('decline')}
                >
                  Decline authorization
                </button>
              )}
              {current.state === 'confirmed' && (
                <button
                  className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
                  disabled={action.pending}
                  onClick={() => decide('withdraw')}
                >
                  Withdraw authorization
                </button>
              )}
              {['expired', 'declined', 'withdrawn'].includes(current.state) && (
                <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`} onClick={reset}>
                  Start a new authorization
                </button>
              )}
            </>
          )}
          {current && !bound && (
            <p role="alert">Task terms have changed. Review the current terms before authorizing work.</p>
          )}
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => refreshHandoffStatus(handoffId)}
          >
            Refresh authorization
          </button>
        </>
      )}
      <PartnerNotice action={action} />
    </PartnerGroup>
  )
}
function SiteFunding({ task }: { task: PartnerTaskView }) {
  const balance = usePartnerBalance()
  const action = usePartnerAction()
  const asset = task.terms.reward!.asset
  return (
    <PartnerGroup title="Reserve site credits">
      <PartnerQueryStatus query={balance} retry={() => refreshPartnerWork(task.projectId)} />
      {balance.data && (
        <p>
          Available · {balance.data.available} credits. Held for tasks · {balance.data.held} credits.
        </p>
      )}
      <button
        className={PAGE_ACTION_BUTTON_CLASS}
        disabled={!balance.data || action.pending || BigInt(balance.data.available) < BigInt(asset.quantity)}
        onClick={() =>
          void action.run(
            ['fund', task.taskId, task.termsDigest],
            (k) => fundPartnerTask(task, k),
            () => action.setNotice('Reward reserved. You can now publish the task.'),
          )
        }
      >
        Reserve {asset.quantity} credits
      </button>
      <PartnerNotice action={action} />
    </PartnerGroup>
  )
}
export function TaskWorkDetail({
  projectId,
  workId,
  onBack,
  embedded = false,
}: {
  projectId: string
  workId: string
  onBack: () => void
  embedded?: boolean
}) {
  const navigation = useRelations()
  const read = usePartnerTask(projectId, workId)
  const task = read.data
  const [editing, setEditing] = useState(false)
  const [identityInputs, setIdentityInputs] = useState<
    Record<string, { domainAscii: string; identityRevision: number }>
  >({})
  const [cancel, setCancel] = useState(false)
  const [text, setText] = useState('')
  const action = usePartnerAction()
  const refresh = () => refreshPartnerWork(projectId)
  const awaitingPartner = !!task && (
    ['reserving', 'delivering', 'returning'].includes(task.funding) ||
    task.submissions.some(s => s.verdict === 'pending' || s.provenance === 'pending')
  )
  useEffect(() => {
    if (!awaitingPartner) return
    const check = () => {
      if (document.visibilityState === 'visible') refreshPartnerTask(projectId, workId)
    }
    const timer = window.setInterval(check, 7000)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [awaitingPartner, projectId, workId])
  const Frame = embedded ? Fragment : AtomicResourcePage
  if (!task || read.status === 'error')
    return (
      <Frame>
        {!embedded && (
          <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`} onClick={onBack}>
            Back to project
          </button>
        )}
        <PartnerQueryStatus query={read} retry={refresh} />
      </Frame>
    )
  const { terms } = task
  const cmd = (verb: 'publish' | 'claim' | 'cancel' | 'submissions') =>
    void action.run(
      [verb, task.taskId, task.termsDigest, verb === 'submissions' ? text : null],
      (k) =>
        actOnPartnerTask(
          task,
          verb,
          k,
          verb === 'submissions' ? text : undefined,
          verb === 'publish' ? identityInputs : undefined,
        ),
      () => {
        setText('')
        setCancel(false)
        action.setNotice('Task updated.')
      },
    )
  const canSubmit =
    task.status === 'published' && (task.terms.participation !== 'single-claim' || task.claim === 'mine')
  const siteHeld = terms.reward?.partnerId === 'agent-commons'
  return (
    <Frame>
      {!embedded && (
        <>
          <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`} onClick={onBack}>
            Back to project
          </button>
          <ResourcePageHeader
            title="Task offer"
            subtitle={task.status === 'draft' ? 'Private draft' : task.status}
          />
          <p className="whitespace-pre-wrap break-words">{terms.description}</p>
        </>
      )}
      <PartnerGroup title="Task terms">
        <dl className="grid gap-3 text-[13px]">
          <div>
            <dt className="font-semibold">Reward</dt>
            <dd>
              {terms.reward ? (
                <>
                  {terms.reward.asset.quantity} {terms.reward.asset.unit} · {terms.reward.asset.assetId}
                  <Issuer task={task} id={terms.reward.partnerId} />
                  <span>Funding · {task.funding}</span>
                  <br />
                  Hold expires {new Date(terms.reward.holdUntil).toLocaleString()}
                </>
              ) : (
                'Volunteer · No reward promised'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Acceptance</dt>
            <dd>
              {terms.acceptance?.kind === 'sha256-prefix' ? (
                <>
                  Agent Commons checks SHA-256 for {terms.acceptance.difficultyBits} leading zero bits. Prefix ·{' '}
                  <code>{JSON.stringify(terms.acceptance.prefix)}</code>
                </>
              ) : terms.acceptance?.kind === 'partner' ? (
                <>
                  {terms.acceptance.rule.ruleId} · version {terms.acceptance.rule.version}
                  <Issuer task={task} id={terms.acceptance.partnerId} />
                </>
              ) : (
                'Open-ended contributions'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Execution</dt>
            <dd>
              {terms.provenance ? (
                <>
                  {terms.provenance.model} {terms.provenance.effort} · receipt required{' '}
                  <Issuer task={task} id={terms.provenance.partnerId} />
                  Up to {terms.provenance.maxInputTokens} input and {terms.provenance.maxOutputTokens} output
                  tokens
                </>
              ) : (
                'Any means of producing the result'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Participation</dt>
            <dd>
              {terms.participation === 'single-claim'
                ? 'One contributor claims the task'
                : 'Open for submissions'}
            </dd>
          </div>
          {terms.deadline && (
            <div>
              <dt>Deadline</dt>
              <dd>{new Date(terms.deadline).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </PartnerGroup>
      {task.previousOffer && (
        <button
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          onClick={() => navigation.navigate('projects', task.projectId, task.previousOffer!.taskId)}
        >
          View previous offer · version {task.previousOffer.termsVersion}
        </button>
      )}
      {task.requester && task.status !== 'draft' && (
        <PartnerGroup title="Revise offer">
          {editing ? (
            <>
              <p className="text-[13px]">
                Saving creates a new private offer. Existing commitments stay with this version. Reserve the new
                reward before publication.
              </p>
              <TaskTermsEditor
                initial={terms}
                pending={action.pending}
                onClose={() => setEditing(false)}
                onSave={(next) =>
                  void action.run(
                    ['revise', task.taskId, task.termsDigest, next],
                    (k) => revisePartnerTask(task, next, k),
                    (created) => navigation.navigate('projects', projectId, created.taskId),
                  )
                }
              />
            </>
          ) : (
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              onClick={() => setEditing(true)}
            >
              Create revised offer
            </button>
          )}
        </PartnerGroup>
      )}
      {task.requester && task.status === 'draft' && (
        <div className="space-y-2">
          {editing ? (
            <TaskTermsEditor
              initial={terms}
              pending={action.pending}
              onClose={() => setEditing(false)}
              onSave={(next) =>
                void action.run(
                  ['save', task.taskId, task.termsVersion, next],
                  (k) => savePartnerTask(task, next, k),
                  () => setEditing(false),
                )
              }
            />
          ) : (
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              disabled={task.funding !== 'volunteer' && task.funding !== 'awaiting'}
              onClick={() => setEditing(true)}
            >
              Edit task terms
            </button>
          )}
          {terms.reward &&
            task.funding === 'awaiting' &&
            (siteHeld ? (
              <SiteFunding task={task} />
            ) : (
              <AccountHandoff task={task} id={terms.reward.partnerId} purpose="reserve" />
            ))}
          {terms.reward && task.funding !== 'held' && (
            <p className="text-[13px]">Publication is waiting for confirmation of the full reward.</p>
          )}
          {Array.from(
            new Set([
              terms.provenance?.partnerId,
              terms.reward?.partnerId,
              terms.acceptance?.kind === 'partner' ? terms.acceptance.partnerId : undefined,
            ]),
          )
            .filter((v): v is string => !!v && v !== 'agent-commons')
            .map((id) => (
              <PublicationIdentity
                key={id}
                partnerId={id}
                onChange={(value) =>
                  setIdentityInputs((previous) => {
                    const next = { ...previous }
                    if (value) next[id] = value
                    else delete next[id]
                    return next
                  })
                }
              />
            ))}
          <button
            className={PAGE_ACTION_BUTTON_CLASS}
            disabled={editing || action.pending || (!!terms.reward && task.funding !== 'held')}
            onClick={() => cmd('publish')}
          >
            Publish task
          </button>
        </div>
      )}
      {task.status === 'published' && terms.participation === 'single-claim' && task.claim === 'available' && (
        <button
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          disabled={action.pending}
          onClick={() => cmd('claim')}
        >
          Claim task
        </button>
      )}
      {canSubmit && !terms.provenance && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            cmd('submissions')
          }}
        >
          <label className="grid gap-1">
            Your submission
            <textarea
              className={FORM_INPUT_CLASS}
              rows={4}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className={PAGE_ACTION_BUTTON_CLASS} disabled={action.pending || !text.length}>
            Submit work
          </button>
        </form>
      )}
      {canSubmit && terms.provenance && (
        <AccountHandoff task={task} id={terms.provenance.partnerId} purpose="run" />
      )}
      {terms.reward &&
        !siteHeld &&
        task.submissions.some((s) => s.mine && s.submissionId === task.winnerId) &&
        task.funding === 'held' && <AccountHandoff task={task} id={terms.reward.partnerId} purpose="receive" />}
      <PartnerGroup title="Submissions">
        {task.submissions.length === 0 ? (
          <p>No submissions yet.</p>
        ) : (
          <ol className="space-y-3">
            {task.submissions.map((s) => (
              <li key={s.submissionId} className="border-l border-line pl-3">
                <p className="text-[13px]">
                  {s.mine ? 'Your submission' : 'Submission'} · {new Date(s.submittedAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap break-words">{s.text}</p>
                {s.digest && (
                  <button
                    className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(
                        ['download', s.submissionId],
                        () => downloadPartnerOutput(task.projectId, task.taskId, s.submissionId),
                        (blob) => {
                          const href = URL.createObjectURL(blob),
                            link = document.createElement('a')
                          link.href = href
                          link.download = 'submission-' + s.submissionId + '.bin'
                          link.click()
                          window.setTimeout(() => URL.revokeObjectURL(href), 60000)
                        },
                      )
                    }
                  >
                    Download submission
                  </button>
                )}
                <p className="text-[13px]">
                  Acceptance · {s.verdict === 'unavailable' ? 'provider or verifier unavailable' : s.verdict} ·
                  Compute proof · {s.provenance}
                </p>
              </li>
            ))}
          </ol>
        )}
      </PartnerGroup>
      <div className="flex flex-wrap gap-2">
        <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`} onClick={refresh}>
          Refresh task
        </button>
        {task.requester && ['draft', 'published'].includes(task.status) && (
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => setCancel(!cancel)}
          >
            Cancel task
          </button>
        )}
      </div>
      {cancel && (
        <div className="space-y-1">
          <p>Close this task and request the return of any eligible held reward?</p>
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            disabled={action.pending}
            onClick={() => cmd('cancel')}
          >
            Confirm cancellation
          </button>
        </div>
      )}
      <PartnerNotice action={action} />
    </Frame>
  )
}

function PublicationIdentity({
  partnerId,
  onChange,
}: {
  partnerId: string
  onChange: (value: { domainAscii: string; identityRevision: number } | null) => void
}) {
  const catalog = usePartnerCatalog({ partnerId })
  const partner = catalog.data?.items.find((p) => p.partnerId === partnerId)
  const [domain, setDomain] = useState('')
  if (!partner) return <PartnerQueryStatus query={catalog} retry={() => refreshPartnerWork('')} />
  if (partner.trustedForActor)
    return (
      <p className="break-words text-[13px]">
        Previously confirmed · <bdi>{partner.displayName}</bdi> ·{' '}
        <bdi dir="ltr">{partner.identity.domainAscii}</bdi>
        {partner.identity.collisionSignals.length > 0 && <> · {partnerCollisionLabel(partner.identity.collisionSignals)}</>}
      </p>
    )
  return (
    <div className="space-y-1 border-l border-line pl-3">
      <p>
        <strong>
          <bdi>{partner.displayName}</bdi>
        </strong>{' '}
        ·{' '}
        <bdi dir="ltr" className="break-all font-mono">
          {partner.identity.domainAscii}
        </bdi>
      </p>
      <PartnerField
        label={'Confirm website for ' + partner.displayName}
        value={domain}
        onChange={(e) => {
          const next = e.target.value
          setDomain(next)
          onChange(
            next.trim()
              ? { domainAscii: next.trim().toLowerCase(), identityRevision: partner.identity.identityRevision }
              : null,
          )
        }}
        hint={
          partner.identity.collisionSignals.length
            ? partnerCollisionLabel(partner.identity.collisionSignals) + '. For a first authorization, enter the domain from your own records.'
            : 'Enter an independently known domain if your prior authorization has changed.'
        }
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
      />
    </div>
  )
}
