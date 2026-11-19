import { PartnerObligations } from './PartnerOperations'
import { useState } from 'react'
import type {
  PartnerApplication,
  PartnerCapability,
  PartnerDomainPurpose,
  PartnerEnvironment,
} from '../../contract/taskPartners'
import {
  usePartnerApplication,
  usePartnerApplications,
  usePartnerAudit,
  usePartnerCatalog,
  usePartnerConformance,
  usePartnerDomainChallenge,
  refreshPartnerRegistry,
} from '../api/hooks'
import {
  renameTaskPartner,
  issuePartnerDomain,
  readPartnerDomainChallenge,
  startPartnerConformance,
  provePartnerSigningKey,
  changePartnerKey,
  reviewPartner,
} from '../api/commands'
import { usePartnerAction } from '../controller/usePartnerAction'
import {
  CopyPartnerValue,
  PartnerField,
  PartnerGroup,
  PartnerNotice,
  PartnerQueryStatus,
  applicationStates,
  environmentName,
  roleNames,
  PartnerSelect,
} from './PartnerFields'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'
import { ResourcePageHeader } from './ResourcePage'
import { parsePartnerKey } from '../lib/partnerSigningKey'
import { PartnerPagination } from './PartnerFields'

function DomainProof({ app, purpose }: { app: PartnerApplication; purpose: PartnerDomainPurpose }) {
  const challenge = app.domainChallengeIds[purpose]
  const result = usePartnerDomainChallenge(app.environment, app.applicationId, challenge)
  const action = usePartnerAction()
  const [replacement, setReplacement] = useState('')
  const label = purpose === 'website' ? 'Public website' : 'Account authorization website'
  const current = result.data
  return (
    <fieldset className="space-y-2 border-l border-line pl-3">
      <legend className="px-1 font-medium">{label}</legend>
      <p className="break-all text-sm">{purpose === 'website' ? app.organizationUrl : app.handoffUrl}</p>
      {challenge && <PartnerQueryStatus query={result} retry={refreshPartnerRegistry} />}
      {current && (
        <>
          <p className="text-sm">Domain proof · {current.state}</p>
          {current.state === 'pending' && (
            <>
              <p className="text-sm">
                Publish this TXT record in your DNS, then check again. Expires{' '}
                {new Date(current.expiresAt).toLocaleString()}.
              </p>
              <CopyPartnerValue label="DNS record name" value={current.recordName} />
              <CopyPartnerValue label="TXT record value" value={current.recordValue} />
            </>
          )}
        </>
      )}
      {app.viewer?.canManage && (
        <div className="flex flex-wrap gap-2">
          {current?.state === 'pending' && (
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending}
              onClick={() =>
                void action.run(
                  ['check', challenge],
                  () => readPartnerDomainChallenge(app.environment, app.applicationId, current.challengeId),
                  (r) => {
                    refreshPartnerRegistry()
                    action.setNotice(
                      r.state === 'verified' ? 'Domain verified.' : 'The DNS record is not verified yet.',
                    )
                  },
                )
              }
            >
              Check DNS record
            </button>
          )}
          {(!current || current.state !== 'pending') && (
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending || (!!challenge && !current)}
              onClick={() =>
                void action.run(['domain', purpose, app.revision], (key) =>
                  issuePartnerDomain(app.environment, app, purpose, key),
                )
              }
            >
              {current?.state === 'verified' ? 'Renew domain proof' : 'Get DNS instructions'}
            </button>
          )}
        </div>
      )}
      {app.viewer?.canManage && (
        <details>
          <summary>Change verified address</summary>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void action.run(
                ['replace', purpose, app.revision, replacement],
                (key) => issuePartnerDomain(app.environment, app, purpose, key, replacement),
                () => {
                  setReplacement('')
                  action.setNotice(
                    'New domain proof requested. Complete the DNS challenge to change the verified address.',
                  )
                },
              )
            }}
          >
            <PartnerField
              label={'Replacement ' + label.toLowerCase() + ' URL'}
              type="url"
              required
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <p className="text-sm text-ink-faint">
              A verified change requires fresh authorization for new work.
            </p>
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending}
            >
              Request replacement proof
            </button>
          </form>
        </details>
      )}
      <PartnerNotice action={action} />
    </fieldset>
  )
}
function SigningKeys({ app }: { app: PartnerApplication }) {
  const action = usePartnerAction()
  const [proof, setProof] = useState('')
  const [keyJson, setKeyJson] = useState('')
  const [revoke, setRevoke] = useState('')
  const [reason, setReason] = useState('')
  return (
    <PartnerGroup title="Service signing keys">
      {app.keys.map((k) => (
        <div key={k.kid} className="break-all text-sm">
          <strong>{k.kid}</strong> · {k.state}
          <p className="font-mono">{k.thumbprint}</p>
        </div>
      ))}
      {app.viewer?.canManage && app.challenge && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(
              ['prove', proof],
              (k) => provePartnerSigningKey(app.environment, app.applicationId, proof.trim(), k),
              () => {
                setProof('')
                action.setNotice('Key possession verified.')
              },
            )
          }}
        >
          <p className="text-sm">
            Sign this challenge on your server with the matching private key. It expires{' '}
            {new Date(app.challenge.expiresAt).toLocaleString()}.
          </p>
          <CopyPartnerValue label="Key challenge" value={JSON.stringify(app.challenge, null, 2)} />
          <PartnerField
            label="Signed proof (compact JWS)"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
            disabled={action.pending}
          >
            Verify signing key
          </button>
        </form>
      )}
      {app.viewer?.canManage && (
        <details>
          <summary>Manage signing keys</summary>
          <form
            className="my-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void action.run(
                ['key', app.revision, keyJson],
                (k) =>
                  changePartnerKey(
                    app.environment,
                    app,
                    { action: 'register', publicKey: parsePartnerKey(keyJson) },
                    k,
                  ),
                () => setKeyJson(''),
              )
            }}
          >
            <PartnerField
              label="Replacement public key (JWK)"
              value={keyJson}
              onChange={(e) => setKeyJson(e.target.value)}
              required
            />
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending}
            >
              Register and request proof
            </button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void action.run(
                ['revoke', app.revision, revoke, reason],
                (k) => changePartnerKey(app.environment, app, { action: 'revoke', kid: revoke, reason }, k),
                () => {
                  setRevoke('')
                  setReason('')
                },
              )
            }}
          >
            <PartnerSelect label="Key to revoke" value={revoke} onChange={setRevoke} required>
              <option value="">Choose a key</option>
              {app.keys
                .filter((k) => k.state !== 'revoked')
                .map((k) => (
                  <option value={k.kid} key={k.kid}>
                    {k.kid} · {k.state}
                  </option>
                ))}
            </PartnerSelect>
            <PartnerField
              label="Reason for revocation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={300}
            />
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending || !revoke}
            >
              Revoke selected key
            </button>
          </form>
        </details>
      )}
      <PartnerNotice action={action} />
    </PartnerGroup>
  )
}
function Decision({ app }: { app: PartnerApplication }) {
  const allowed =
    app.state === 'in_review'
      ? ['approve', 'reject']
      : app.state === 'active'
        ? ['suspend', 'revoke']
        : app.state === 'suspended'
          ? ['resume', 'revoke']
          : []
  const [choice, setChoice] = useState('')
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<PartnerCapability[]>([])
  const action = usePartnerAction()
  return (
    <PartnerGroup title="Production review">
      <p className="text-sm">
        Requested capabilities · {app.requestedCapabilities.map((c) => roleNames[c]).join(', ')}
      </p>
      <p className="text-sm">
        Operational contact · {app.contact}
        <br />
        Recovery contact · {app.recoveryContact}
      </p>
      {allowed.length > 0 && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            const decision = {
              action: choice,
              reason: reason.trim(),
              ...(choice === 'approve' ? { acceptedCapabilities: scope } : {}),
            }
            void action.run(
              [app.revision, decision],
              (k) => reviewPartner(app.environment, app, decision, k),
              () => {
                setChoice('')
                setReason('')
                action.setNotice('Decision recorded.')
              },
            )
          }}
        >
          <PartnerSelect label="Decision" value={choice} onChange={setChoice} required>
            <option value="">Choose a decision</option>
            {allowed.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </PartnerSelect>
          {choice === 'approve' && (
            <fieldset>
              <legend>Capabilities to approve</legend>
              {app.requestedCapabilities.map((c) => (
                <label key={c} className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={scope.includes(c)}
                    onChange={(e) => setScope(e.target.checked ? [...scope, c] : scope.filter((r) => r !== c))}
                  />
                  {roleNames[c]}
                </label>
              ))}
            </fieldset>
          )}
          <PartnerField
            label="Decision reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={300}
          />
          <button
            className={PAGE_ACTION_BUTTON_CLASS}
            disabled={action.pending || !choice || (choice === 'approve' && scope.length === 0)}
          >
            Record decision
          </button>
        </form>
      )}
      <PartnerNotice action={action} />
    </PartnerGroup>
  )
}
function Badge({
  app,
  webOrigin,
  badgeOrigin,
}: {
  app: PartnerApplication
  webOrigin: string | null
  badgeOrigin: string | null
}) {
  const host = new URL(app.organizationUrl).hostname
  const registry = usePartnerCatalog({ domainAscii: host })
  const partner = registry.data?.items.find((x) => x.partnerId === app.partnerId)
  return (
    <PartnerGroup title="Website badge">
      <PartnerQueryStatus query={registry} retry={refreshPartnerRegistry} />
      {registry.data &&
        (!partner ? (
          <p>Badge unavailable until production approval and current domain verification.</p>
        ) : !webOrigin || !badgeOrigin ? (
          <p>
            The site operator must configure the public profile and badge origins before a badge can be issued.
          </p>
        ) : (
          <BadgeMarkup
            displayName={partner.displayName}
            host={partner.identity.domainAscii}
            roles={partner.capabilities}
            profile={new URL(partner.identity.profilePath, webOrigin).href}
            frame={
              new URL(
                '/v1/task-partners/public/partners/' +
                  encodeURIComponent(partner.partnerId) +
                  '/badge?domain=' +
                  encodeURIComponent(partner.identity.domainAscii),
                badgeOrigin,
              ).href
            }
          />
        ))}
    </PartnerGroup>
  )
}
function BadgeMarkup({
  displayName,
  host,
  roles,
  profile,
  frame,
}: {
  displayName: string
  host: string
  roles: PartnerCapability[]
  profile: string
  frame: string
}) {
  const escapeAttribute = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const html =
    '<iframe src="' +
    escapeAttribute(frame) +
    '" title="Agent Commons partner" referrerpolicy="no-referrer" width="290" height="100"></iframe>\n<a href="' +
    escapeAttribute(profile) +
    '" rel="noopener noreferrer">View partner on Agent Commons</a>'
  return (
    <>
      <p className="text-sm">
        Eligible website ·{' '}
        <bdi className="break-all font-mono" dir="ltr">
          {host}
        </bdi>
      </p>
      <a
        className="block rounded-lg border border-line p-3"
        href={profile}
        target="_blank"
        rel="noopener noreferrer"
      >
        <strong>
          <bdi>{displayName}</bdi>
        </strong>
        <br />
        <bdi dir="ltr">{host}</bdi>
        <br />
        {roles.map((c) => roleNames[c]).join(' · ')} · View profile
      </a>
      <CopyPartnerValue label="Embed code" value={html} />
      <CopyPartnerValue label="Profile link" value={profile} />
    </>
  )
}
export default function PartnerApplicationDetail({ env, id }: { env: PartnerEnvironment; id: string }) {
  const appRead = usePartnerApplication(env, id)
  const metadata = usePartnerApplications(env)
  const [cursors, setCursors] = useState<string[]>([])
  const audit = usePartnerAudit(env, id, cursors.at(-1))
  const app = appRead.data
  const report = usePartnerConformance(env, id, app?.conformanceReportId)
  const action = usePartnerAction()
  if (!app || appRead.status === 'error')
    return <PartnerQueryStatus query={appRead} retry={refreshPartnerRegistry} />
  return (
    <>
      <ResourcePageHeader
        title={<bdi>{app.displayName}</bdi>}
        subtitle={environmentName(env) + ' · ' + applicationStates[app.state]}
      />
      <p className="break-all font-mono">{new URL(app.organizationUrl).hostname}</p>
      <p className="text-sm text-ink-faint">
        {app.organization} · {app.requestedCapabilities.map((c) => roleNames[c]).join(' · ')}
      </p>
      {app.viewer?.canManage && (
        <details>
          <summary>Edit display name</summary>
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = String(new FormData(e.currentTarget).get('displayName') ?? '').trim()
              void action.run(
                ['name', id, app.revision, name],
                (k) => renameTaskPartner(env, app, name, k),
                () =>
                  action.setNotice('Display name updated. Your partner ID and verified domain are unchanged.'),
              )
            }}
          >
            <PartnerField
              label="New public display name"
              name="displayName"
              required
              maxLength={100}
              defaultValue={app.displayName}
            />
            <button
              className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
              disabled={action.pending}
            >
              Save display name
            </button>
          </form>
        </details>
      )}
      <p className="text-xs text-ink-faint">Partner ID · {app.partnerId}</p>
      {app.decisionReason && <p className="text-sm">Latest decision · {app.decisionReason}</p>}
      <PartnerGroup title="Verify domain ownership">
        <DomainProof app={app} purpose="website" />
        <DomainProof app={app} purpose="handoff" />
      </PartnerGroup>
      <SigningKeys app={app} />
      <PartnerGroup title="Conformance checks">
        {app.conformanceReportId && (
          <>
            <PartnerQueryStatus query={report} retry={refreshPartnerRegistry} />
            {report.data && (
              <>
                <p>Report · {report.data.state}</p>
                <CopyPartnerValue label="Report ID" value={report.data.reportId} />
                <ul>
                  {report.data.checks.map((c) => (
                    <li key={c.name} className="py-1 text-sm">
                      {c.name} · {c.status}
                      {c.detail && <p>{c.detail}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {env === 'sandbox' && app.viewer?.canManage && (
          <button
            className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
            disabled={
              action.pending ||
              app.state !== 'sandbox_testing' ||
              report.data?.state === 'running' ||
              report.data?.state === 'queued'
            }
            onClick={() =>
              void action.run(
                ['conformance', app.revision],
                (k) => startPartnerConformance(env, app, k),
                () =>
                  action.setNotice('Conformance checks started. Your worker can poll its assigned commands.'),
              )
            }
          >
            Run sandbox checks
          </button>
        )}
        <button
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={refreshPartnerRegistry}
        >
          Refresh status
        </button>
        <PartnerNotice action={action} />
      </PartnerGroup>
      {app.environment === 'production' && app.viewer?.canReview && (
        <>
          {metadata.data?.recoveryRole && (
            <PartnerObligations partnerId={app.partnerId} canOpen={metadata.data.recoveryRole === 'incident'} />
          )}
          <Decision app={app} />
        </>
      )}
      {env === 'production' && app.viewer?.canManage && (
        <Badge
          app={app}
          webOrigin={metadata.data?.webOrigin ?? null}
          badgeOrigin={metadata.data?.badgeOrigin ?? null}
        />
      )}
      <PartnerGroup title="Application history">
        <PartnerQueryStatus query={audit} retry={refreshPartnerRegistry} />
        <ol>
          {audit.data?.items.map((v) => (
            <li key={v.eventId} className="py-1 text-sm">
              <time dateTime={v.recordedAt}>{new Date(v.recordedAt).toLocaleString()}</time> ·{' '}
              {v.action.replaceAll('_', ' ')}
              {v.reason && <p>{v.reason}</p>}
            </li>
          ))}
        </ol>
        <PartnerPagination next={audit.data?.nextCursor} cursors={cursors} set={setCursors} />
      </PartnerGroup>
    </>
  )
}
