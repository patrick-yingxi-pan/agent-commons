import { useState } from 'react'
import { usePartnerCatalog } from '../api/hooks'
import { PartnerField, PartnerSelect, PartnerGroup, roleNames, PartnerQueryStatus } from './PartnerFields'
import { refreshPartnerRegistry } from '../api/hooks'
import type { PartnerCapability, PartnerCatalogEntry } from '../../contract/taskPartners'
import type { PartnerTaskTerms } from '../../contract/taskPartnerWork'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'

function SelectPartner({
  role,
  value,
  onPick,
  site,
}: {
  role: PartnerCapability
  value: string
  onPick: (value: string, party?: PartnerCatalogEntry) => void
  site?: boolean
}) {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const partners = usePartnerCatalog({ capability: role, name: search, cursor })
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <PartnerField
          label={'Find a ' + roleNames[role].toLowerCase()}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
        />
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
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
            partners.data?.items.find((p) => p.partnerId === id),
          )
        }
      >
        <option value="">Choose a partner</option>
        {site && <option value="agent-commons">Agent Commons · Site-held work credits</option>}
        {partners.data?.items.map((p) => (
          <option key={p.partnerId} value={p.partnerId}>
            {p.displayName} · {p.identity.domainAscii}
            {p.identity.collisionSignals.length ? ' · Similar names' : ''}
          </option>
        ))}
        {value && value !== 'agent-commons' && !partners.data?.items.some((p) => p.partnerId === value) && (
          <option value={value}>Previously selected partner · {value}</option>
        )}
      </PartnerSelect>
      {partners.data?.nextCursor && (
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={() => setCursor(partners.data!.nextCursor!)}
        >
          More matching partners
        </button>
      )}
      {cursor && (
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
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
  const [verifier, setVerifier] = useState<PartnerCatalogEntry>()
  const [ruleIndex, setRuleIndex] = useState('')
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
            const rule =
              verifier?.catalog.rules[Number(ruleIndex)] ??
              (initial?.acceptance?.kind === 'partner' && initial.acceptance.partnerId === verifierId
                ? initial.acceptance.rule
                : undefined)
            if (!rule) throw new Error('Choose the executable rule for this task.')
            terms.acceptance = { kind: 'partner', partnerId: verifierId, rule }
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
      <label className="grid gap-1 text-sm">
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
      <label className="grid gap-1 text-sm">
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
        <label className="flex gap-2">
          <input type="checkbox" checked={reward} onChange={(e) => setReward(e.target.checked)} />
          Offer a reserved reward
        </label>
        {!reward && <p className="text-sm text-ink-faint">Volunteer task. No reward is promised.</p>}
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
            <p className="text-sm text-ink-faint">
              The full reward must be held before this task can be published.
            </p>
          </>
        )}
      </PartnerGroup>
      <PartnerGroup title="Acceptance">
        <PartnerSelect label="How is a submission accepted?" value={accept} onChange={setAccept}>
          <option value="none">Open-ended feedback</option>
          <option value="sha256-prefix">Agent Commons · SHA-256 nonce check</option>
          <option value="partner">Accepted verifier · Published rule</option>
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
              onPick={(id, p) => {
                setVerifierId(id)
                setVerifier(p)
                setRuleIndex('')
              }}
            />
            <PartnerSelect
              label="Executable rule"
              value={ruleIndex}
              required={!initial?.acceptance || !!verifier}
              onChange={setRuleIndex}
            >
              <option value="">
                {!verifier && initial?.acceptance?.kind === 'partner'
                  ? initial.acceptance.rule.ruleId
                  : 'Choose a rule'}
              </option>
              {verifier?.catalog.rules.map((r, i) => (
                <option key={i} value={String(i)}>
                  {r.ruleId} · version {r.version}
                </option>
              ))}
            </PartnerSelect>
          </>
        )}
      </PartnerGroup>
      <PartnerGroup title="Compute provenance">
        <label className="flex gap-2">
          <input type="checkbox" checked={provenance} onChange={(e) => setProvenance(e.target.checked)} />
          Require a model provider receipt
        </label>
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
            <label className="grid gap-1 text-sm">
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
            <div className="grid gap-2 sm:grid-cols-2">
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
          className={SECONDARY_BUTTON_CLASS + ' min-h-8 px-3 py-1 text-[13px]'}
          onClick={onClose}
          disabled={pending}
        >
          Cancel edit
        </button>
      </div>
    </form>
  )
}
