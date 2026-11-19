import { CheckboxRow } from './Checkbox'
import { partnerCollisionLabel } from '../../contract/taskPartners'
import { DOOR_CLASS } from '../lib/textDoor'
import { parsePartnerKey } from '../lib/partnerSigningKey'
import { PartnerCredits } from './PartnerOperations'
import { useState } from 'react'
import type { PartnerCapability, PartnerEnvironment } from '../../contract/taskPartners'
import { usePartnerApplications, usePartnerCatalog, refreshPartnerRegistry } from '../api/hooks'
import {
  roleNames,
  environmentName,
  applicationStates,
  PartnerGroup,
  PartnerNotice,
  PartnerSelect,
  PartnerField,
  PartnerProfileName,
  PartnerPagination,
  PartnerQueryStatus,
} from './PartnerFields'
import { usePartnerAction } from '../controller/usePartnerAction'
import { registerPartner } from '../api/commands'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'
import { AtomicResourcePage, CompositeResourcePage, ResourcePageHeader } from './ResourcePage'
import PartnerApplicationDetail from './PartnerApplicationDetail'
import type { PartnerApplicationRequest } from '../../contract/taskPartners'

export const roles = Object.keys(roleNames) as PartnerCapability[]
function EnvironmentPicker({
  value,
  onChange,
}: {
  value: PartnerEnvironment
  onChange: (value: PartnerEnvironment) => void
}) {
  return (
    <PartnerSelect label="Environment" value={value} onChange={(v) => onChange(v as PartnerEnvironment)}>
      <option value="sandbox">Sandbox</option>
      <option value="production">Production</option>
    </PartnerSelect>
  )
}
function Registration({ onOpen }: { onOpen: (address: string) => void }) {
  const [env, setEnv] = useState<PartnerEnvironment>('sandbox')
  return (
    <div className="space-y-4">
      <EnvironmentPicker value={env} onChange={setEnv} />
      <RegistrationForm key={env} env={env} onOpen={onOpen} />
    </div>
  )
}
function RegistrationForm({ env, onOpen }: { env: PartnerEnvironment; onOpen: (address: string) => void }) {
  const [selected, setSelected] = useState<PartnerCapability[]>([])
  const [counts, setCounts] = useState({ models: 1, assets: 1, rules: 1 })
  const action = usePartnerAction()
  const access = usePartnerApplications(env)
  const add = (kind: keyof typeof counts) => setCounts({ ...counts, [kind]: counts[kind] + 1 })
  if (!access.data || access.status === 'error')
    return <PartnerQueryStatus query={access} retry={refreshPartnerRegistry} />
  if (access.data.canManage === false)
    return <p>Ask an administrator of your organization to register a task partner.</p>
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        const get = (key: string) => String(data.get(key) ?? '').trim()
        void action.run(
          ['register', env, selected, Array.from(data.entries())],
          async (key) => {
            if (!selected.length) throw new Error('Choose at least one capability.')
            const body: PartnerApplicationRequest = {
              displayName: get('displayName'),
              organization: get('organization'),
              organizationUrl: get('website'),
              handoffUrl: get('handoff'),
              contact: get('contact'),
              recoveryContact: get('recovery'),
              publicKey: parsePartnerKey(get('publicKey')),
              capabilities: selected,
              catalog: {
                models: selected.includes('model-provider')
                  ? Array.from({ length: counts.models }, (_, i) => ({
                      model: get('model' + i),
                      efforts: get('effort' + i)
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  : [],
                assets: selected.includes('custodian')
                  ? Array.from({ length: counts.assets }, (_, i) => ({
                      assetId: get('asset' + i),
                      unit: get('unit' + i),
                    }))
                  : [],
                rules: selected.includes('verifier')
                  ? Array.from({ length: counts.rules }, (_, i) => ({
                      ruleId: get('rule' + i),
                      version: Number(get('version' + i)),
                      digest: get('digest' + i),
                    }))
                  : [],
              },
              ...(env === 'production' ? { sandboxReportId: get('report') } : {}),
            }
            return registerPartner(env, body, key)
          },
          (app) => onOpen(env + '/' + app.applicationId),
        )
      }}
    >
      <p className="text-[13px] text-ink-faint">
        {env === 'sandbox'
          ? 'Start in the sandbox to test your integration before applying for production.'
          : 'Use a separate production signing key and your passing sandbox report.'}
      </p>
      {env === 'production' && <PartnerField name="report" label="Passing sandbox report ID" required />}
      <PartnerGroup title="Organization">
        <PartnerField name="displayName" label="Public display name" required maxLength={100} />
        <PartnerField name="organization" label="Organization name" required maxLength={160} />
        <PartnerField
          name="website"
          label="Website URL"
          type="url"
          required
          placeholder="https://your-organization.example"
          hint="People will see the full verified domain beside your display name."
        />
        <PartnerField name="contact" label="Operational email" type="email" required />
        <PartnerField
          name="recovery"
          label="Recovery contact"
          required
          hint="How Agent Commons can reach you about outstanding work or rewards."
        />
      </PartnerGroup>
      <PartnerGroup title="Capabilities offered">
        {roles.map((role) => (
          <CheckboxRow
            key={role}
            checked={selected.includes(role)}
            disabled={role === 'custodian' && selected.includes('verifier')}
            onToggle={() => {
              if (selected.includes(role)) setSelected(selected.filter((c) => c !== role))
              else if (role === 'verifier') setSelected([...new Set<PartnerCapability>([...selected, 'custodian', role])])
              else setSelected([...selected, role])
            }}
          >
            {roleNames[role]}
          </CheckboxRow>
        ))}
        {selected.includes('verifier') && <p className="text-[13px] text-ink-faint">Acceptance verifiers must also qualify as custodians.</p>}
        {selected.includes('model-provider') && (
          <fieldset className="space-y-2">
            <legend>Attested models</legend>
            {Array.from({ length: counts.models }, (_, i) => (
              <div key={i} className="grid gap-2 @sm:grid-cols-2">
                <PartnerField label="Model ID" name={'model' + i} required />
                <PartnerField label="Effort levels (comma separated)" name={'effort' + i} />
              </div>
            ))}
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              type="button"
              onClick={() => add('models')}
            >
              Add another model
            </button>
          </fieldset>
        )}
        {selected.includes('custodian') && (
          <fieldset className="space-y-2">
            <legend>Reward inventory</legend>
            {Array.from({ length: counts.assets }, (_, i) => (
              <div key={i} className="grid gap-2 @sm:grid-cols-2">
                <PartnerField label="Issuer-qualified asset ID" name={'asset' + i} required />
                <PartnerField label="Deliverable unit" name={'unit' + i} required />
              </div>
            ))}
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              type="button"
              onClick={() => add('assets')}
            >
              Add another asset
            </button>
          </fieldset>
        )}
        {selected.includes('verifier') && (
          <fieldset className="space-y-2">
            <legend>Executable rules</legend>
            {Array.from({ length: counts.rules }, (_, i) => (
              <div key={i} className="grid gap-2">
                <PartnerField label="Rule ID" name={'rule' + i} required />
                <PartnerField
                  label="Rule version"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={1}
                  name={'version' + i}
                  required
                />
                <PartnerField
                  label="Rule program SHA-256 digest"
                  name={'digest' + i}
                  pattern="[a-f0-9]{64}"
                  required
                />
              </div>
            ))}
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              type="button"
              onClick={() => add('rules')}
            >
              Add another rule
            </button>
          </fieldset>
        )}
      </PartnerGroup>
      <PartnerGroup title="Technical setup">
        <PartnerField
          name="handoff"
          label="Account authorization URL"
          type="url"
          required
          hint="The HTTPS page where people authorize work on your service."
        />
        <label className="grid gap-1 text-[13px]">
          Public signing key (JWK)
          <textarea
            name="publicKey"
            required
            rows={4}
            className={FORM_INPUT_CLASS + ' font-mono'}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="text-[12px] text-ink-faint">
          Provide the public portion of an Ed25519 key. A private key stays on your server.
        </p>
      </PartnerGroup>
      <PartnerNotice action={action} />
      <button disabled={action.pending} className={PAGE_ACTION_BUTTON_CLASS}>
        Submit application
      </button>
    </form>
  )
}
export function PartnerDirectory() {
  const [mode, setMode] = useState('name')
  const [text, setText] = useState('')
  const [query, setQuery] = useState({ mode: 'name', text: '' })
  const [cursors, setCursors] = useState<string[]>([])
  const options = query.mode === 'domain' ? { domainAscii: query.text.toLowerCase() } : { name: query.text }
  const found = usePartnerCatalog({ ...options, cursor: cursors.at(-1) })
  return (
    <section className="space-y-3">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setCursors([])
          setQuery({ mode, text: text.trim() })
        }}
      >
        <PartnerSelect label="Find a partner by" value={mode} onChange={setMode}>
          <option value="name">Organization name</option>
          <option value="domain">Exact website domain</option>
        </PartnerSelect>
        <PartnerField
          label={mode === 'domain' ? 'Exact verified domain' : 'Organization name'}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={253}
        />
        <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 justify-self-start px-3 py-1 text-[13px]`}>Search partners</button>
      </form>
      <PartnerQueryStatus query={found} retry={refreshPartnerRegistry} />
      {found.data && found.status !== 'error' && (
        <>
          {found.data.items.length === 0 ? (
            <p role="status" className="text-[13px] text-ink-faint">
              {query.text
                ? 'No approved partners match this search.'
                : 'No partners have been approved for production yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {found.data.items.map((p) => (
                <li key={p.partnerId} className="min-w-0 py-3">
                  <PartnerProfileName
                    origin={found.data?.webOrigin}
                    path={p.identity.profilePath}
                    name={p.displayName}
                  />
                  <p className="break-all font-mono text-[13px]">
                    <bdi dir="ltr">{p.identity.domainAscii}</bdi>
                  </p>
                  <p className="text-[13px] text-ink-faint">
                    {p.capabilities.map((c) => roleNames[c]).join(' · ')}
                  </p>
                  {p.identity.collisionSignals.length > 0 && (
                    <p className="text-[13px]">
                      {partnerCollisionLabel(p.identity.collisionSignals)}. Check the full domain before choosing this partner.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <PartnerPagination next={found.data.nextCursor} cursors={cursors} set={setCursors} />
        </>
      )}
    </section>
  )
}
function Applications({ onOpen }: { onOpen: (id: string) => void }) {
  const [env, setEnv] = useState<PartnerEnvironment>('sandbox')
  const [cursors, setCursors] = useState<string[]>([])
  const page = usePartnerApplications(env, cursors.at(-1))
  return (
    <div className="space-y-3">
      <EnvironmentPicker
        value={env}
        onChange={(next) => {
          setEnv(next)
          setCursors([])
        }}
      />
      <PartnerQueryStatus query={page} retry={refreshPartnerRegistry} />
      {page.data && <PartnerCredits canIssue={page.data.canReview} />}
      {page.data && page.status !== 'error' && (
        <>
          {page.data.items.length === 0 && <p className="text-[13px]">No applications in this environment.</p>}
          <ul className="divide-y divide-line">
            {page.data.items.map((a) => (
              <li key={a.applicationId}>
                <button
                  className={DOOR_CLASS + ' w-full py-3 text-left'}
                  onClick={() => onOpen(env + '/' + a.applicationId)}
                >
                  <strong>
                    <bdi>{a.displayName}</bdi>
                  </strong>{' '}
                  · {applicationStates[a.state]}
                  <span className="block break-all text-[13px]">{a.organizationUrl}</span>
                </button>
              </li>
            ))}
          </ul>
          <PartnerPagination cursors={cursors} set={setCursors} next={page.data.nextCursor} />
        </>
      )}
    </div>
  )
}
export default function TaskPartnersPage({
  subview,
  application,
  onOpen,
  onSwitch,
  onBack,
}: {
  subview: string | null
  application: string | null
  onOpen: (id: string) => void
  onSwitch: (view: string | null) => void
  onBack: () => void
}) {
  const [env, id] = (application ?? '').split('/')
  if (id && (env === 'sandbox' || env === 'production'))
    return (
      <AtomicResourcePage>
        <button className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`} onClick={onBack}>
          Back
        </button>
        <PartnerApplicationDetail key={application} env={env} id={id} />
      </AtomicResourcePage>
    )
  const title =
    subview === 'register'
      ? 'Register partner'
      : subview === 'applications'
        ? 'Partner applications'
        : 'Task partners'
  return (
    <CompositeResourcePage section="task-partners" projectSections={false}>
      <ResourcePageHeader
        title={title}
        subtitle={
          subview ? undefined : 'Find organizations approved to attest work, check results, or hold rewards.'
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {subview && (
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => onSwitch(null)}
          >
            Partner directory
          </button>
        )}
        {subview !== 'applications' && (
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => onSwitch('applications')}
          >
            Partner applications
          </button>
        )}
        {subview !== 'register' && (
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            onClick={() => onSwitch('register')}
          >
            Register partner
          </button>
        )}
      </div>
      {subview === 'register' ? (
        <Registration onOpen={onOpen} />
      ) : subview === 'applications' ? (
        <Applications onOpen={onOpen} />
      ) : (
        <PartnerDirectory />
      )}
    </CompositeResourcePage>
  )
}
