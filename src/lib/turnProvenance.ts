import type { Message, ModelProvider } from '../../contract/index.ts'

/** Historical execution identity comes only from the turn's recorded IDs.
 * The viewer's registry may decorate that exact connection with its current
 * label/kind, never fill missing history from an Agent or today's model pick.
 * Keep the exact model ID even after catalog replacement or access removal. */
export function turnProvenance(
  message: Pick<Message, 'providerId' | 'modelId'>,
  providers: readonly Pick<ModelProvider, 'id' | 'label' | 'kind'>[] | undefined,
  registryFailed = false,
): { label: string; relayed: boolean } {
  if (!message.providerId) {
    return {
      label: message.modelId ? `Model connection not recorded · ${message.modelId}` : 'Model details not recorded',
      relayed: false,
    }
  }
  const provider = providers?.find(row => row.id === message.providerId)
  const connection = provider?.label ?? (registryFailed ? 'Model connection could not be loaded'
    : providers === undefined ? 'Loading model connection…' : 'Model connection unavailable')
  const relayed = provider?.kind === 'session'
  return {
    label: `${connection} · ${message.modelId ?? (relayed ? 'via your delegated session' : 'Model not recorded')}`,
    relayed,
  }
}
