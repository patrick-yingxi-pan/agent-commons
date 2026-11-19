import type { SectionId } from '../types'

/** Shared by the deferred page headers and search palette. Sidebar navigation
 * needs only the label and icon, so descriptions load with their readers. */
export const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  'task-partners': 'Find a verified partner or register your organization.',
  commons: 'What your world shares — published resources, their threads, and what just landed.',
  projects: 'Group related work and the context it shares.',
  artifacts: 'Every document, deck, sheet, and image you’ve made.',
  contexts: 'Accounts, servers, and repos you’ve set up once and reuse across sessions.',
  models: 'The models your sessions run on — built-in Claude, endpoints you register, and your own delegated sessions.',
  agents: 'Worker agents, the prompts they start from, and where they’re commissioned.',
  scheduled: 'Recurring workflows Claude runs for you on a cadence.',
  discussions: 'Threads on the resources you share and follow.',
  messages: 'Direct conversations with the people you can reach.',
  notifications: 'What happened to what you own, watch, or posted — while you weren’t looking.',
  sessions: 'Your conversations with Claude, ready to resume or organize.',
  dispatch: 'One-off task history and execution availability.',
  customize: 'Make the workspace yours.',
  admin: 'Instance administration for website maintainers.',
}
