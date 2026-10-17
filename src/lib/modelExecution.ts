import type { ModelExecution, ModelProvider } from '../../contract/index.ts'

export interface ComposerExecutionState {
  blocked: boolean
  placeholder?: string
  note: string
}

/** Whether one registry entry can answer a turn right now. Endpoint readiness
 * comes from the server-computed execution posture; Session providers retain
 * their independent live-connector signal. Keeping this beside the composer
 * decision gives first-run guidance and send gating one meaning of "ready". */
export function modelProviderAvailable(provider: ModelProvider): boolean {
  return provider.kind === 'session'
    ? provider.online === true
    : provider.execution === 'configured' || provider.execution === 'mock'
}

/** A resolved registry with no runnable entry needs setup before an empty draft
 * can honestly invite typing. Callers distinguish unresolved query data from an
 * empty resolved registry before invoking this predicate. */
export function modelSetupRequired(providers: ModelProvider[]): boolean {
  return !providers.some(modelProviderAvailable)
}

/** One copy decision for the composer's model boundary. The provider registry is
 * server-owned; the client only projects its computed execution status. */
export function composerExecutionState(
  execution?: ModelExecution,
  sessionProviderOnline?: boolean,
  providerUnavailable = false,
  missingModelId?: string,
): ComposerExecutionState {
  if (sessionProviderOnline === false) {
    return {
      blocked: true,
      placeholder: 'Start this Session provider to begin…',
      note: 'This Session provider is offline. Start its drain loop, or choose another provider.',
    }
  }
  if (sessionProviderOnline === true) {
    return {
      blocked: false,
      note: 'Session provider connected · tool actions still require your confirmation.',
    }
  }
  if (providerUnavailable) {
    return {
      blocked: true,
      placeholder: 'This model connection is unavailable to this account.',
      note: 'This model connection is unavailable to this account.',
    }
  }
  if (missingModelId) {
    return {
      blocked: true,
      placeholder: 'Choose an available model…',
      note: `Model '${missingModelId}' is unavailable. Choose an available model in Model and effort, or update this connection in Models.`,
    }
  }
  if (execution === undefined) {
    return {
      blocked: true,
      placeholder: 'Checking model connection…',
      note: 'Checking the selected model connection…',
    }
  }
  if (execution === 'unconfigured') {
    return {
      blocked: true,
      placeholder: 'Connect a model provider to begin…',
      note: 'No model endpoint is configured. Choose another provider or add one from Models.',
    }
  }
  if (execution === 'configured') {
    return {
      blocked: false,
      note: 'Connected model · tool actions still require your confirmation.',
    }
  }
  return {
    blocked: false,
    note: 'Prototype · the model is a local mock, but every turn is a real round-trip through the tool interface.',
  }
}
