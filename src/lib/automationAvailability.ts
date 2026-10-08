/** Small, eager capability policy shared by rail and lazy page presentation. */
export function automationAvailability(simulatedAutomation: boolean | undefined) {
  const state = simulatedAutomation === true ? 'fixture' : simulatedAutomation === false ? 'unavailable' : 'unknown'
  return { state, canSimulate: state === 'fixture' } as const
}

/** Real Dispatch admission is independent of the legacy simulation flag. */
export function dispatchAvailable(dispatchExecution: boolean | undefined): boolean {
  return dispatchExecution === true
}
