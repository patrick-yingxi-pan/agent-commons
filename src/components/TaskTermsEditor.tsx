import { CheckboxRow } from './Checkbox'
import { partnerCollisionLabel } from '../../contract/taskPartners'
import { useState } from 'react'
import { refreshPartnerRegistry, usePartnerCatalog } from '../api/hooks'
import { PartnerField, PartnerSelect, PartnerGroup, roleNames, PartnerQueryStatus } from './PartnerFields'
import type { PartnerCapability, PartnerCatalogEntry, PartnerRule } from '../../contract/taskPartners'
import type { PartnerTaskTerms } from '../../contract/taskPartnerWork'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'

function taskVerifierRules(partner?: PartnerCatalogEntry): PartnerRule[] {
  return partner?.capabilities.includes('custodian') && partner.capabilities.includes('verifier')
    ? partner.catalog.rules
    : []
}
function ruleKey(rule: PartnerRule) {
  return JSON.stringify([rule.ruleId, rule.version, rule.digest])
}

function SelectPartner({
  role,
  value,
  onPick,
  site,
  selected,
}: {
  role: PartnerCapability
  value: string
  onPick: (value: string, party?: PartnerCatalogEntry) => void
  site?: boolean
  selected?: PartnerCatalogEntry
}) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const partners = usePartnerCatalog({ capability: role, name: search, cursor })
  const items = (partners.data?.items ?? []).filter((p) => role !== 'verifier' || taskVerifierRules(p).length > 0)
  const options = selected && !items.some((p) => p.partnerId === selected.partnerId)
    ? [...items, selected]
    : items
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <PartnerField
          label={role === 'verifier' ? 'Find an acceptance verifier' : 'Find a ' + roleNames[role].toLowerCase()}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
        />
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          onClick={() => {
            setSearch(q.trim())
            setCursor(null)
          }}
        >
          Find partners
        </button>
      </div>
      <PartnerQueryStatus query={partners} retry={refreshPartnerRegistry} />
      <PartnerSelect
        label={roleNames[role]}
        required
        value={value}
        onChange={(id) =>
          onPick(
            id,
            options.find((p) => p.partnerId === id),
          )
        }
      >
        <option value="">Choose a partner</option>
        {site && <option value="agent-commons">Agent Commons · Site-held work credits</option>}
        {options.map((p) => (
          <option key={p.partnerId} value={p.partnerId}>
            {[p.displayName, p.identity.domainAscii, partnerCollisionLabel(p.identity.collisionSignals)].filter(Boolean).join(' · ')}
          </option>
        ))}
        {value && value !== 'agent-commons' && !options.some((p) => p.partnerId === value) && (
          <option value={value} disabled={role === 'verifier'}>Previously selected partner · {value}</option>
        )}
      </PartnerSelect>
      {role === 'verifier' && partners.data && !items.length && (
        <p className="text-[13px] text-ink-faint">No matching custodian with published acceptance rules on this page.</p>
      )}
      {partners.data?.nextCursor && (
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          onClick={() => setCursor(partners.data!.nextCursor!)}
        >
          More matching partners
        </button>
      )}
      {cursor && (
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          onClick={() => setCursor(null)}
        >
          First page
        </button>
      )}
    </div>
  )
}
function localDateTime(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export default function TaskTermsEditor({
  initial,
  pending,
  onSave,
  onClose,
}: {
  initial?: PartnerTaskTerms
  pending: boolean
  onSave: (terms: PartnerTaskTerms) => void
  onClose: () => void
}) {
  const [accept, setAccept] = useState(initial?.acceptance?.kind ?? 'none')
  const [reward, setReward] = useState(!!initial?.reward)
  const [provenance, setProvenance] = useState(!!initial?.provenance)
  const [holder, setHolder] = useState(initial?.reward?.partnerId ?? '')
  const [asset, setAsset] = useState(initial?.reward?.asset.assetId ?? '')
  const [custodian, setCustodian] = useState<PartnerCatalogEntry>()
  const [providerId, setProviderId] = useState(initial?.provenance?.partnerId ?? '')
  const [provider, setProvider] = useState<PartnerCatalogEntry>()
  const [model, setModel] = useState(initial?.provenance?.model ?? '')
  const [verifierId, setVerifierId] = useState(
    initial?.acceptance?.kind === 'partner' ? initial.acceptance.partnerId : '',
  )
  const selectedPartner = usePartnerCatalog({ partnerId: verifierId }, accept === 'partner' && !!verifierId)
  const verifier = selectedPartner.data?.items.find((p) => p.partnerId === verifierId)
  const rules = taskVerifierRules(verifier)
  const [rule, setRule] = useState<PartnerRule | undefined>(
    initial?.acceptance?.kind === 'partner' ? initial.acceptance.rule : undefined,
  )
  const exactRule = rule && rules.find((r) => ruleKey(r) === ruleKey(rule))
  const [error, setError] = useState('')
  return (
    <form
      className="min-w-0 space-y-3 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        try {
          const data = new FormData(e.currentTarget)
          const str = (name: string) => String(data.get(name) ?? '').trim()
          const terms: PartnerTaskTerms = {
            description: str('description'),
            participation: str('participation') as PartnerTaskTerms['participation'],
          }
          if (str('deadline')) terms.deadline = new Date(str('deadline')).toISOString()
          if (accept === 'sha256-prefix')
            terms.acceptance = {
              kind: 'sha256-prefix',
              prefix: String(data.get('prefix') ?? ''),
              difficultyBits: Number(str('bits')),
            }
          if (accept === 'partner') {
            if (!exactRule) throw new Error('Choose a published rule from a custodian approved to run it.')
            terms.acceptance = { kind: 'partner', partnerId: verifierId, rule: exactRule }
          }
          if (reward) {
            if (!terms.deadline || Date.parse(str('holdUntil')) <= Date.parse(terms.deadline))
              throw new Error('Reserve the reward beyond the submission deadline to allow time for settlement.')
            if (!terms.acceptance) throw new Error('A task with a reward needs an executable acceptance rule.')
            const unit =
              holder === 'agent-commons'
                ? 'credit'
                : (custodian?.catalog.assets.find((a) => a.assetId === asset)?.unit ??
                  initial?.reward?.asset.unit)
            if (!unit) throw new Error('Choose an asset offered by the selected custodian.')
            terms.reward = {
              partnerId: holder,
              asset: {
                assetId: holder === 'agent-commons' ? 'commons.work-credit' : asset,
                unit,
                quantity: str('quantity'),
              },
              holdUntil: new Date(str('holdUntil')).toISOString(),
            }
          }
          if (provenance)
            terms.provenance = {
              partnerId: providerId,
              model,
              ...(str('effort') ? { effort: str('effort') } : {}),
              maxInputTokens: Number(str('maxInput')),
              maxOutputTokens: Number(str('maxOutput')),
            }
          onSave(terms)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Check the task fields.')
        }
      }}
    >
      <label className="grid gap-1 text-[13px]">
        What should the contributor deliver?
        <textarea
          name="description"
          className={FORM_INPUT_CLASS}
          defaultValue={initial?.description}
          required
          rows={3}
          maxLength={2000}
        />
      </label>
      <label className="grid gap-1 text-[13px]">
        Participation
        <select
          className={FORM_INPUT_CLASS}
          name="participation"
          defaultValue={initial?.participation ?? 'first-valid'}
        >
          <option value="first-valid">Open for submissions</option>
          <option value="single-claim">One contributor claims the task</option>
        </select>
      </label>
      <PartnerField
        label={reward ? 'Submission deadline' : 'Submission deadline (optional)'}
        required={reward}
        type="datetime-local"
        name="deadline"
        defaultValue={localDateTime(initial?.deadline)}
      />
      <PartnerGroup title="Reward">
        <CheckboxRow checked={reward} onToggle={() => setReward(!reward)}>
          Offer a reserved reward
        </CheckboxRow>
        {!reward && <p className="text-[13px] text-ink-faint">Volunteer task. No reward is promised.</p>}
        {reward && (
          <>
            <SelectPartner
              role="custodian"
              site
              value={holder}
              onPick={(id, p) => {
                setHolder(id)
                setCustodian(p)
                setAsset('')
              }}
            />
            {holder && holder !== 'agent-commons' && (
              <PartnerSelect label="Reward asset" required value={asset} onChange={setAsset}>
                <option value="">Choose an asset</option>
                {custodian?.catalog.assets.map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {a.assetId} · {a.unit}
                  </option>
                ))}
                {!custodian && asset && <option value={asset}>{asset}</option>}
              </PartnerSelect>
            )}
            <PartnerField
              label={holder === 'agent-commons' ? 'Work credits promised' : 'Quantity promised'}
              name="quantity"
              inputMode="numeric"
              pattern="[1-9][0-9]{0,37}"
              required
              defaultValue={initial?.reward?.asset.quantity}
            />
            <PartnerField
              label="Reserve reward until"
              type="datetime-local"
              name="holdUntil"
              required
              defaultValue={localDateTime(initial?.reward?.holdUntil)}
            />
            <p className="text-[13px] text-ink-faint">
              The full reward must be held before this task can be published.
            </p>
          </>
        )}
      </PartnerGroup>
      <PartnerGroup title="Acceptance">
        <PartnerSelect
          label="How is a submission accepted?"
          required={reward}
          value={reward && accept === 'none' ? '' : accept}
          onChange={setAccept}
        >
          {reward
            ? <option value="" disabled>Choose an executable acceptance rule</option>
            : <option value="none">Open-ended feedback</option>}
          <option value="sha256-prefix">Agent Commons · SHA-256 nonce check</option>
          <option value="partner">Accepted custodian · Published rule</option>
        </PartnerSelect>
        {accept === 'sha256-prefix' && (
          <>
            <PartnerField
              label="Text prefix"
              name="prefix"
              maxLength={256}
              defaultValue={initial?.acceptance?.kind === 'sha256-prefix' ? initial.acceptance.prefix : ''}
            />
            <PartnerField
              label="Required leading zero bits"
              name="bits"
              type="number"
              min={1}
              max={256}
              required
              defaultValue={
                initial?.acceptance?.kind === 'sha256-prefix' ? initial.acceptance.difficultyBits : 8
              }
              hint="The site hashes the UTF-8 bytes of the prefix followed immediately by the submitted text."
            />
          </>
        )}
        {accept === 'partner' && (
          <>
            <SelectPartner
              role="verifier"
              value={verifierId}
              selected={rules.length ? verifier : undefined}
              onPick={(id) => {
                setVerifierId(id)
                setRule(undefined)
              }}
            />
            {verifierId && <PartnerQueryStatus query={selectedPartner} retry={refreshPartnerRegistry} />}
            <PartnerSelect
              label="Executable rule"
              value={exactRule ? ruleKey(exactRule) : ''}
              required
              onChange={(value) => setRule(rules.find((r) => ruleKey(r) === value))}
            >
              <option value="">Choose a rule</option>
              {rules.map((r) => (
                <option key={ruleKey(r)} value={ruleKey(r)}>
                  {r.ruleId} · version {r.version}
                </option>
              ))}
            </PartnerSelect>
            {verifierId && selectedPartner.data && !rules.length && (
              <p className="text-[13px] text-ink-faint">
                This partner has no current approval to run an acceptance rule. Choose another custodian or the site check.
              </p>
            )}
            {rule && rules.length > 0 && !exactRule && (
              <p className="text-[13px] text-ink-faint">
                The selected version of {rule.ruleId} is unavailable. Choose a current rule or another acceptance method.
              </p>
            )}
          </>
        )}
      </PartnerGroup>
      <PartnerGroup title="Compute provenance">
        <CheckboxRow checked={provenance} onToggle={() => setProvenance(!provenance)}>
          Require a model provider receipt
        </CheckboxRow>
        {provenance && (
          <>
            <SelectPartner
              role="model-provider"
              value={providerId}
              onPick={(id, p) => {
                setProviderId(id)
                setProvider(p)
                setModel('')
              }}
            />
            <PartnerSelect label="Attested model" value={model} onChange={setModel} required>
              <option value="">Choose a model</option>
              {provider?.catalog.models.map((m) => (
                <option key={m.model}>{m.model}</option>
              ))}
              {!provider && model && <option>{model}</option>}
            </PartnerSelect>
            <label className="grid gap-1 text-[13px]">
              Effort level
              <select
                key={model}
                name="effort"
                className={FORM_INPUT_CLASS}
                defaultValue={initial?.provenance?.effort ?? ''}
              >
                <option value="">Any supported effort</option>
                {provider?.catalog.models
                  .find((m) => m.model === model)
                  ?.efforts.map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                {!provider && initial?.provenance?.effort && <option>{initial.provenance.effort}</option>}
              </select>
            </label>
            <div className="grid gap-2 @sm:grid-cols-2">
              <PartnerField
                label="Maximum input tokens"
                name="maxInput"
                type="number"
                min={1}
                required
                defaultValue={initial?.provenance?.maxInputTokens}
              />
              <PartnerField
                label="Maximum output tokens"
                name="maxOutput"
                type="number"
                min={1}
                required
                defaultValue={initial?.provenance?.maxOutputTokens}
              />
            </div>
          </>
        )}
      </PartnerGroup>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={PAGE_ACTION_BUTTON_CLASS} disabled={pending}>
          Save task draft
        </button>
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
          onClick={onClose}
          disabled={pending}
        >
          Cancel edit
        </button>
      </div>
    </form>
  )
}
