import { useId, useRef, useState } from 'react'
import { Cpu, Plug } from 'lucide-react'
import { useMe } from '../api/hooks.ts'
import { desktopCredentialsAvailable } from '../api/desktopCredentials.ts'
import {
  createProviderConnectionAttempt,
  enqueueProviderConnection,
  useProviderConnectionStatus,
} from '../controller/providerConnectionMutations.ts'
import { enqueueProviderCreation } from '../controller/providerCreationMutations.ts'
import { updateProviderDefinition } from '../controller/providerDefinitionMutations.ts'
import { providerProtocolLabel, providerSetupDefaults, type ProviderProtocol, type ProviderSetupPreset } from '../lib/providerSetup.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { FormDialog, FormField } from './FormDialog.tsx'
import { DefaultToggle } from './Checkbox.tsx'
import { RelayBadge, RelaySecretPanel } from './RelaySecretPanel.tsx'
import type { CreatedProvider, ModelProvider } from '../../contract/index.ts'
import {
  DEFAULT_REPLY_OUTPUT_TOKENS,
  MAX_REPLY_OUTPUT_TOKENS,
  MIN_REPLY_OUTPUT_TOKENS,
  isReplyOutputTokens,
  resolveReplyOutputTokens,
} from '../../contract/providerReplyLimits.ts'

function ReplyOutputLimitField({ value, onChange }: {
  value: number | ''
  onChange: (value: number | '') => void
}) {
  const controlId = useId()
  return <FormField label="Reply output limit" controlId={controlId}>
    <input id={controlId} aria-describedby={`${controlId}-help`} type="number" min={MIN_REPLY_OUTPUT_TOKENS} max={MAX_REPLY_OUTPUT_TOKENS} step={1} value={value}
      onChange={event => {
        const next = event.currentTarget.valueAsNumber
        onChange(Number.isFinite(next) ? next : '')
      }} className={FORM_INPUT_CLASS} />
    <span id={`${controlId}-help`} className="mt-1 block text-[11px] leading-relaxed text-ink-faint">
      Per model call for conversation, Dispatch, Routine, and Project-draft replies ({MIN_REPLY_OUTPUT_TOKENS.toLocaleString()}–{MAX_REPLY_OUTPUT_TOKENS.toLocaleString()} tokens; reasoning included). This is not a total-spend cap; tool-free reviews and summaries use separate limits.
    </span>
  </FormField>
}

export interface ProviderDialogProps {
  provider: ModelProvider | null
  onClose: () => void
  /** First-run Models owns the return policy; report only an acknowledged provider. */
  onCreated?: (provider: CreatedProvider) => void
}

export interface ProviderConnectionDialogProps {
  provider: ModelProvider
  onClose: () => void
}

/** Create / edit a Model provider. New providers pick their transport up front —
 * an API endpoint we dial or the delegated-cognition Session relay. */
export function ProviderDialog({ provider, onClose, onCreated }: ProviderDialogProps) {
  const original = useRef(provider).current
  const tenantId = useMe().data?.tenant.id
  const [label, setLabel] = useState(provider?.label ?? '')
  const [family, setFamily] = useState(provider?.modelFamily ?? 'claude')
  const [kind, setKind] = useState<'endpoint' | 'session'>(provider?.kind ?? 'endpoint')
  const [preset, setPreset] = useState<ProviderSetupPreset>('custom')
  const [protocol, setProtocol] = useState<ProviderProtocol>(provider?.protocol ?? 'anthropic-messages')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [replyOutputTokens, setReplyOutputTokens] = useState<number | ''>(DEFAULT_REPLY_OUTPUT_TOKENS)
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [apiKey, setApiKey] = useState('')
  const hasSecureDeviceVault = desktopCredentialsAvailable()
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [minted, setMinted] = useState<CreatedProvider | null>(null)
  const isSession = kind === 'session'
  const labelChanged = !!provider && label.trim() !== (original?.label ?? '')
  const familyChanged = !!provider && !isSession && family.trim() !== (original?.modelFamily ?? '')
  const defaultChanged = !!provider && isDefault !== (original?.isDefault ?? false)
  const hasEditChanges = labelChanged || familyChanged || defaultChanged
  const canSubmit = label.trim().length > 0 &&
    (isSession || (family.trim().length > 0 && (provider !== null || (model.trim().length > 0 && baseURL.trim().length > 0 && isReplyOutputTokens(replyOutputTokens))))) &&
    (!!provider || !!tenantId) && (!provider || hasEditChanges) && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (provider) {
        const outcome = await updateProviderDefinition(provider.id, {
          ...(labelChanged ? { label: label.trim() } : {}),
          ...(familyChanged ? { modelFamily: family.trim() } : {}),
          ...(defaultChanged ? { isDefault } : {}),
        })
        if (outcome === 'discarded') {
          setError('Your held edits were not saved. Review the latest provider, then apply what you still want.')
          setBusy(false)
          return
        }
        onClose()
      } else if (isSession) {
        const result = await enqueueProviderCreation({
          tenantId: tenantId!,
          request: { label: label.trim(), modelFamily: 'claude', effortLevels: ['Low', 'Medium', 'High'], kind: 'session', ...(isDefault ? { isDefault } : {}) },
        })
        if (result.outcome === 'discarded') {
          setError('Your provider details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
        if (!result.provider?.secret) throw new Error('The provider was created, but its relay secret could not be confirmed. Open the provider and rotate its secret.')
        setMinted(result.provider)
      } else {
        if (!isReplyOutputTokens(replyOutputTokens)) return
        const result = await enqueueProviderCreation({
          tenantId: tenantId!,
          request: {
            label: label.trim(), modelFamily: family.trim(), effortLevels: [],
            config: { protocol, baseURL: baseURL.trim(), model: model.trim(), replyOutputTokens, ...(!hasSecureDeviceVault && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}) },
            ...(isDefault ? { isDefault } : {}),
          },
          ...(hasSecureDeviceVault && apiKey.trim() ? { deviceSecret: apiKey.trim() } : {}),
        })
        if (result.outcome === 'discarded') {
          setError('Your provider details are still here. Review them, then create again when ready.')
          setBusy(false)
          return
        }
        if (!result.provider) throw new Error('The provider acknowledgement was incomplete. Review the registry before trying again.')
        onClose()
        onCreated?.(result.provider)
        return
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this provider.')
      setBusy(false)
    }
  }

  if (minted?.secret) return <RelaySecretPanel provider={minted} secret={minted.secret} onClose={onClose} />
  return <FormDialog title={provider ? 'Edit provider' : 'New provider'} icon={<Cpu size={18} className="text-ink-soft" />}
    submitLabel={provider ? 'Save' : 'Create'} canSubmit={canSubmit} onSubmit={submit} onClose={onClose} error={error} busy={busy}>
    {!provider && <FormField label="Kind">
      <div className="flex gap-1 rounded-lg border border-line bg-panel p-1">
        {([['endpoint', 'API endpoint'], ['session', 'My AI session']] as const).map(([value, text]) =>
          <button key={value} type="button" onClick={() => setKind(value)} className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition ${kind === value ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-faint hover:text-ink-soft'}`}>{text}</button>)}
      </div>
      {isSession && <span className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-faint"><span className="mt-0.5 shrink-0"><RelayBadge /></span>
        An AI session you already run does the thinking — nothing to dial, no key. You get a one-time rendezvous secret and a drain loop to start; tool calls are relayed through your session unexecuted, so relation cards and escalations still land here as consent prompts.
      </span>}
    </FormField>}
    <FormField label="Name"><input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
      placeholder={isSession ? 'e.g. My laptop’s Claude' : 'e.g. Anthropic (prod)'} className={FORM_INPUT_CLASS} /></FormField>
    {!isSession && <>
      {!provider && <FormField label="Provider preset"><select value={preset} onChange={event => {
        const nextPreset = event.target.value as ProviderSetupPreset
        setPreset(nextPreset)
        const defaults = providerSetupDefaults(nextPreset)
        if (!defaults) return
        setProtocol(defaults.protocol); setBaseURL(defaults.baseURL); setModel(defaults.model); setFamily(defaults.modelFamily)
      }} className={FORM_INPUT_CLASS}>
        <option value="custom">Custom</option><option value="anthropic">Claude / Anthropic</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option>
      </select><span className="mt-1 block text-[11px] text-ink-faint">Presets fill editable connection fields. The model ID is required; capabilities come from the provider catalog.</span></FormField>}
      {!provider && <FormField label="Protocol"><select value={protocol} onChange={event => setProtocol(event.target.value as ProviderProtocol)} className={FORM_INPUT_CLASS}>
        <option value="anthropic-messages">Anthropic Messages</option><option value="openai-responses">OpenAI Responses</option>
      </select></FormField>}
      <FormField label="Model family"><input value={family} onChange={e => setFamily(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="claude" className={FORM_INPUT_CLASS} />
        <span className="mt-1 block text-[11px] text-ink-faint">A system prompt tuned for a different family shows a fit warning when picked.</span></FormField>
      {!provider && <>
        <FormField label="Endpoint URL"><input type="url" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="https://models.example.com/v1" className={FORM_INPUT_CLASS} />
          <span className="mt-1 block text-[11px] text-ink-faint">The URL is editable. The selected protocol is verified before it is saved.</span></FormField>
        <FormField label="Model ID"><input value={model} onChange={e => setModel(e.target.value)} placeholder="Enter the model ID from the provider" className={FORM_INPUT_CLASS} /></FormField>
        <ReplyOutputLimitField value={replyOutputTokens} onChange={setReplyOutputTokens} />
        <p className="text-[11px] leading-snug text-ink-faint">Provider API access uses a separate API key; a consumer chat subscription does not supply one.</p>
        {hasSecureDeviceVault ? <FormField label="API key (optional)"><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste API key" autoComplete="new-password" spellCheck={false} className={FORM_INPUT_CLASS} />
          <span className="mt-1 block text-[11px] text-ink-faint">Encrypted for your OS account and kept outside Agent Commons data. The backend stores only a generated reference.</span></FormField>
          : <FormField label="Credential variable (optional)"><input value={apiKeyEnv} onChange={e => setApiKeyEnv(e.target.value.toUpperCase())} placeholder="PROVIDER_TEAM_KEY" className={FORM_INPUT_CLASS} />
            <span className="mt-1 block text-[11px] text-ink-faint">Enter a <span className="font-mono">PROVIDER_*</span> variable already available to the server. Only its name is stored; the secret never enters this app.</span></FormField>}
      </>}
    </>}
    <DefaultToggle checked={isDefault} onChange={setIsDefault} entity="provider" />
  </FormDialog>
}

/** Replace only supplied endpoint fields; credentials stay write-only and the
 * complete effective connection is verified before the controller swaps it. */
export function ProviderConnectionDialog({ provider, onClose }: ProviderConnectionDialogProps) {
  const me = useMe().data
  const mutation = useProviderConnectionStatus()
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const originalReplyOutputTokens = useRef(resolveReplyOutputTokens({ protocol: provider.protocol, replyOutputTokens: provider.replyOutputTokens })).current
  const [replyOutputTokens, setReplyOutputTokens] = useState<number | ''>(originalReplyOutputTokens)
  const [protocol, setProtocol] = useState<ProviderProtocol>(provider.protocol ?? 'anthropic-messages')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasSecureDeviceVault = desktopCredentialsAvailable()
  const recoveryOwned = mutation.activeResourceId === provider.id && Boolean(mutation.error)
  const replyOutputTokensChanged = isReplyOutputTokens(replyOutputTokens) && replyOutputTokens !== originalReplyOutputTokens
  const protocolChanged = protocol !== (provider.protocol ?? 'anthropic-messages')
  const hasReplacement = Boolean(baseURL.trim() || model.trim() || protocolChanged || replyOutputTokensChanged || (hasSecureDeviceVault ? apiKey.trim() : apiKeyEnv.trim()))
  const submit = async () => {
    if (!hasReplacement || busy || !isReplyOutputTokens(replyOutputTokens)) return
    if (!me) { setError('Wait for your account to finish loading, then try again.'); return }
    setBusy(true); setError(null)
    const attempt = createProviderConnectionAttempt({
      ...(protocolChanged ? { protocol } : {}),
      ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}),
      // Pin the effective value shown in the form when changing protocol. Otherwise
      // an absent legacy Messages value would silently become the Responses default.
      ...(replyOutputTokensChanged || protocolChanged ? { replyOutputTokens } : {}),
      ...(!hasSecureDeviceVault && apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
    }, provider.connectionRevision ?? 0, hasSecureDeviceVault && apiKey.trim() ? apiKey.trim() : undefined, crypto.randomUUID())
    try {
      const outcome = enqueueProviderConnection({ tenantId: me.tenant.id, providerId: provider.id, attempt })
      if (!outcome) { setError('Wait for the current provider change to settle before updating its connection.'); setBusy(false); return }
      if (await outcome === 'applied') onClose()
      else { setError('Your connection details are still here. Review them, then update again when ready.'); setBusy(false) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this connection.'); setBusy(false) }
  }
  return <FormDialog title="Update connection" icon={<Plug size={18} className="text-ink-soft" />} submitLabel="Verify & update"
    canSubmit={hasReplacement && isReplyOutputTokens(replyOutputTokens) && !busy} onSubmit={submit} onClose={onClose} error={error} busy={busy && !recoveryOwned} fieldsDisabled={busy}
    cancelLabel={recoveryOwned ? 'Close form' : 'Cancel'}>
    <p className="text-[12px] leading-relaxed text-ink-soft">Replace only what changed for <span className="font-medium text-ink">{provider.label}</span>. Existing connection details stay write-only; blank fields remain unchanged. The complete connection is verified before anything is saved.</p>
    <FormField label="Endpoint URL" optional><input type="url" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="New URL — leave blank to keep" className={FORM_INPUT_CLASS} /></FormField>
    <FormField label="Protocol"><select value={protocol} onChange={event => setProtocol(event.target.value as ProviderProtocol)} className={FORM_INPUT_CLASS}>
      <option value="anthropic-messages">Anthropic Messages</option><option value="openai-responses">OpenAI Responses</option>
    </select><span className="mt-1 block text-[11px] text-ink-faint">Current protocol: {providerProtocolLabel(provider.protocol)}. Leave it unchanged to keep the existing protocol.</span></FormField>
    <FormField label="Model ID" optional><input value={model} onChange={e => setModel(e.target.value)} placeholder="New model — leave blank to keep" className={FORM_INPUT_CLASS} /></FormField>
    <ReplyOutputLimitField value={replyOutputTokens} onChange={setReplyOutputTokens} />
    {hasSecureDeviceVault ? <FormField label="Replacement API key" optional><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste replacement API key" autoComplete="new-password" spellCheck={false} className={FORM_INPUT_CLASS} />
      <span className="mt-1 block text-[11px] text-ink-faint">Encrypted for your OS account. The previous device key is retired only after this connection is accepted.</span></FormField>
      : <FormField label="Replacement credential variable" optional><input value={apiKeyEnv} onChange={e => setApiKeyEnv(e.target.value.toUpperCase())} placeholder="PROVIDER_REPLACEMENT_KEY" className={FORM_INPUT_CLASS} />
        <span className="mt-1 block text-[11px] text-ink-faint">Name a <span className="font-mono">PROVIDER_*</span> variable already available to the server. Its value never enters this app.</span></FormField>}
  </FormDialog>
}
