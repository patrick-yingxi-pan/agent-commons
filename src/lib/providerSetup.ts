import type { ModelProvider } from '../../contract/index.ts'

export type ProviderProtocol = NonNullable<ModelProvider['protocol']>
export type ProviderSetupPreset = 'anthropic' | 'openai' | 'deepseek' | 'custom'

export interface ProviderSetupDefaults {
  protocol: ProviderProtocol
  baseURL: string
  model: string
  modelFamily: string
}

/** Known connection starting points. Model capabilities and catalogs remain
 * provider-owned; this helper only fills the endpoint form's editable fields. */
export const PROVIDER_SETUP_DEFAULTS: Readonly<Record<Exclude<ProviderSetupPreset, 'custom'>, ProviderSetupDefaults>> = {
  anthropic: {
    protocol: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com',
    model: '',
    modelFamily: 'claude',
  },
  openai: {
    protocol: 'openai-responses',
    baseURL: 'https://api.openai.com/v1',
    model: '',
    modelFamily: 'gpt',
  },
  deepseek: {
    protocol: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-flash',
    modelFamily: 'deepseek',
  },
}

export const PROVIDER_PROTOCOL_LABELS: Readonly<Record<ProviderProtocol, string>> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-responses': 'OpenAI Responses',
}

export function providerSetupDefaults(preset: ProviderSetupPreset): ProviderSetupDefaults | null {
  return preset === 'custom' ? null : { ...PROVIDER_SETUP_DEFAULTS[preset] }
}

export function providerProtocolLabel(protocol: ProviderProtocol | undefined): string {
  return PROVIDER_PROTOCOL_LABELS[protocol ?? 'anthropic-messages']
}
