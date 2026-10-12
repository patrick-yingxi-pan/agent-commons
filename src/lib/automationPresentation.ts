import { automationAvailability } from './automationAvailability.ts'

/** Legacy Standing fixture posture comes only from this backend capability.
 * Separately approved Commission MCP permission follows its own reviewed limits
 * and can start automatically; it does not inherit the fixture flag. */
export function automationPresentation(simulatedAutomation: boolean | undefined) {
  const availability = automationAvailability(simulatedAutomation)
  const { state } = availability
  return {
    ...availability,
    standing: state === 'fixture'
      ? 'Legacy Standing simulation only: eligible posted work may be marked done without running an Agent or calling tools. Separately approved real MCP may start automatically within its reviewed limits.'
      : state === 'unavailable'
        ? 'Legacy Standing simulation is unavailable. This setting is saved for coordination only; separately approved real MCP may still start automatically within its reviewed limits.'
        : 'Legacy Standing simulation availability could not be confirmed. Separately approved real MCP may start automatically within its reviewed limits.',
    work: state === 'fixture'
      ? 'Posting adds this to the Project backlog. Legacy Standing simulation may mark eligible work done without running an Agent or tools; separately approved real MCP may start automatically within its reviewed limits.'
      : state === 'unavailable'
        ? 'Posting adds this to the Project backlog. Legacy Standing simulation is unavailable; separately approved real MCP may start calls automatically within its reviewed limits.'
        : 'Posting adds this to the Project backlog. Legacy Standing simulation availability could not be confirmed; separately approved real MCP may start automatically within its own review and limits.',
  } as const
}

export const AUTOMATION_NOTICE_CLASS = 'mb-3 text-[12px] leading-relaxed text-ink-soft'
