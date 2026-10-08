/** Small, eager capability policy shared by rail and lazy page presentation. */
export function automationAvailability(simulatedAutomation: boolean | undefined) {
  const state = simulatedAutomation === true ? 'fixture' : simulatedAutomation === false ? 'unavailable' : 'unknown'
  return { state, canSimulate: state === 'fixture' } as const
}
