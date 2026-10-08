import { automationAvailability } from './automationAvailability.ts'

/** Legacy fixture posture comes only from the backend capability. Absence or a
 * failed read cannot grant execution; real Routines and Contribution MCP are
 * separate workflows and do not inherit this flag. */
export function automationPresentation(simulatedAutomation: boolean | undefined) {
  const availability = automationAvailability(simulatedAutomation)
  const { state } = availability
  return {
    ...availability,
    dispatch: state === 'fixture'
      ? 'Development simulation. Dispatch does not run an Agent or call tools. Feed statuses describe simulated runs.'
      : state === 'unavailable'
        ? 'Dispatch execution is not available in this release. No Agent will run. Existing feed entries are simulations, not execution receipts. Start a conversation or use a configured Routine.'
        : 'Dispatch availability could not be confirmed. No Agent will run. Existing feed entries are simulations, not execution receipts.',
    standing: state === 'fixture'
      ? 'Development simulation only: eligible posted work may be marked done without running an Agent or calling tools. This setting does not grant real unattended execution.'
      : state === 'unavailable'
        ? 'Standing execution is not available. This setting is saved for coordination only; posted work stays open. It does not grant real unattended execution.'
        : 'Standing execution availability could not be confirmed. A development backend may simulate completion; this setting does not grant real unattended execution.',
    work: state === 'fixture'
      ? 'Posting adds this to the Project backlog. A standing contributor may simulate completion; no Agent or external tool runs.'
      : state === 'unavailable'
        ? 'Posting adds this to the Project backlog. Standing execution is unavailable, so new work stays open until a real workflow handles it.'
        : 'Posting adds this to the Project backlog. Automation availability could not be confirmed; a development backend may simulate completion without running an Agent or tool.',
  } as const
}

export const AUTOMATION_NOTICE_CLASS = 'mb-3 text-[12px] leading-relaxed text-ink-soft'
