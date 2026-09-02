/** Transport and exact authoritative reconciliation for provider registration. */
import type { CreatedProvider, ModelProvider } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { providerCreationId } from './providerCreationIdentity.ts'
import type { ProviderCreationIntent } from './providerCreationRevision.ts'

const results = new Map<string, CreatedProvider>()

function publicProvider(provider: CreatedProvider): ModelProvider {
  const { secret: _secret, ...row } = provider
  return row
}

function remember(intent: ProviderCreationIntent, provider: CreatedProvider): void {
  results.set(intent.intentId, provider)
  const row = publicProvider(provider)
  const cached = peek<ModelProvider[]>(keys.providers)
  if (cached) {
    mutate<ModelProvider[]>(keys.providers, (current) => {
      const rows = current ?? []
      return rows.some((candidate) => candidate.id === row.id)
        ? rows.map((candidate) => candidate.id === row.id ? row : candidate)
        : [...rows, row]
    })
  }
  // Default and execution projections have independent owners. Revalidate the
  // list after publishing the exact acknowledged row rather than treating this
  // response as a complete registry snapshot.
  invalidate(keys.providers)
}

function requestFor(intent: ProviderCreationIntent) {
  if (!intent.credentialReference) return intent.request
  return {
    ...intent.request,
    config: {
      ...intent.request.config,
      apiKeyEnv: intent.credentialReference,
    },
  }
}

export async function applyProviderCreation(
  intent: ProviderCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const provider = await apiPost<CreatedProvider>(
    paths.providers,
    requestFor(intent),
    { idempotencyKey },
  )
  remember(intent, provider)
}

/** Prove the exact tenant-scoped row. A Session-provider retry then repeats the
 * same keyed request so the server can safely reconstruct its one-time secret;
 * a collection GET can prove the row but intentionally cannot expose that
 * bearer. */
export async function reconcileProviderCreation(
  intent: ProviderCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await providerCreationId(intent.tenantId, idempotencyKey)
  const incoming = await apiGet<ModelProvider[]>(paths.providers)
  const represented = incoming.find((provider) => provider.id === expectedId)
  const current = peek<ModelProvider[]>(keys.providers)
  if (!current) setData(keys.providers, incoming)
  else if (represented) {
    mutate<ModelProvider[]>(keys.providers, (rows) => {
      const existing = rows ?? []
      return existing.some((provider) => provider.id === represented.id)
        ? existing.map((provider) => provider.id === represented.id ? represented : provider)
        : [...existing, represented]
    })
  }
  if (!represented) return false

  if (represented.kind === 'session') {
    const recovered = await apiPost<CreatedProvider>(
      paths.providers,
      requestFor(intent),
      { idempotencyKey },
    )
    if (recovered.id !== expectedId || !recovered.secret) return false
    remember(intent, recovered)
  } else {
    remember(intent, represented)
  }
  return true
}

export function peekProviderCreationResult(intentId: string): CreatedProvider | undefined {
  return results.get(intentId)
}

export function takeProviderCreationResult(intentId: string): CreatedProvider | undefined {
  const provider = results.get(intentId)
  results.delete(intentId)
  return provider
}

export function clearProviderCreationResults(): void {
  results.clear()
}
