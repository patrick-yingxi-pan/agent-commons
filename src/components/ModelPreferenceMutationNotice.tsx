import { discardModelPreference, retryModelPreference, useModelPreferenceStatus } from '../controller/modelPreferences.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

export function ModelPreferenceMutationNotice() {
  const mutation = useModelPreferenceStatus()
  return <RevisionedMutationNotice kind="model-preferences" mutation={mutation} pendingLabel="Saving model preference…" onRetry={retryModelPreference} onDiscard={discardModelPreference} />
}
