import type { ModelExecution } from '../../contract/index.ts'

export interface ComposerExecutionState {
  blocked: boolean
  placeholder?: string
  note: string
}

/** One copy decision for the composer's model boundary. The provider registry is
 * server-owned; the client only projects its computed execution status. */
export function composerExecutionState(
  execution?: ModelExecution,
  sessionProviderOnline?: boolean,
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
