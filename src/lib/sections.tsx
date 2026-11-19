import { Bell, Bot, Box, Briefcase, Cable, Clock, Cpu, Mail, MessageSquareText, MessagesSquare, Newspaper, SendHorizontal, Shapes, Wrench } from 'lucide-react'
import type { SectionId } from '../types'

/** The cross-cutting tools in the sidebar nav. One source of truth for the
 *  label / icon so the nav row and the section header always match. */
export const SECTION_META: Record<
  SectionId,
  {
    label: string
    Icon: typeof Box
    beta?: boolean
    /** A chrome gate, never an authorization wall. The server remains the
     *  authority; this keeps navigation and restored view memory aligned with
     *  the identity already established at app bootstrap. */
    availability?: 'instance-admin'
  }
> = {
  'task-partners': {
    label: 'Task partners',
    Icon: Briefcase,
  },
  commons: {
    label: 'Commons',
    Icon: Newspaper,
  },
  projects: {
    label: 'Projects',
    Icon: Box,
  },
  artifacts: {
    label: 'Artifacts',
    Icon: Shapes,
  },
  contexts: {
    label: 'Contexts',
    Icon: Cable,
  },
  models: {
    label: 'Models',
    Icon: Cpu,
  },
  agents: {
    label: 'Agents',
    Icon: Bot,
  },
  scheduled: {
    label: 'Routines',
    Icon: Clock,
  },
  discussions: {
    label: 'Discussions',
    Icon: MessagesSquare,
  },
  // S7 — the DM inbox. A message IS a discussion anchored to a person, so this
  // section and Discussions render the same entity; they are two sections
  // because they are two reading modes (talk about things vs talk with people)
  // and the server lists each row in exactly one of them.
  messages: {
    label: 'Messages',
    Icon: Mail,
  },
  // The inbox (D24). A PAGE, not the overlay it began as (owner directive
  // 2026-08-08): what happened while you weren't looking is a list you triage,
  // and a modal is only for a transient act. As a page it gets an address, a
  // place in the back stack, and a pane of its own like everything else — which
  // is what makes "answer a bell, come back for the next one" work at all.
  notifications: {
    label: 'Notifications',
    Icon: Bell,
  },
  sessions: {
    label: 'Sessions',
    Icon: MessageSquareText,
  },
  dispatch: {
    label: 'Dispatch',
    Icon: SendHorizontal,
    beta: true,
  },
  customize: {
    label: 'Customize',
    Icon: Briefcase,
  },
  // The maintainer console — rail row rendered ONLY for principals whose
  // Identity carries `instanceAdmin` (the MAINTAINERS env allowlist); the
  // server's 404 wall is the gate, this visibility is chrome.
  admin: {
    label: 'Maintain',
    Icon: Wrench,
    availability: 'instance-admin',
  },
}

/** Whether this identity should be offered a section in chrome or restored
 *  into it from per-account view memory. Kept beside SECTION_META so the rail
 *  and workspace restore cannot grow separate capability lists. A direct URL
 *  may still render the section's explanatory denied face; this governs only
 *  chrome and persisted-memory restoration. */
export function sectionAvailable(
  id: SectionId,
  access: { instanceAdmin: boolean },
): boolean {
  return SECTION_META[id].availability !== 'instance-admin' || access.instanceAdmin
}

export const SECTION_ORDER: SectionId[] = [
  // Conversation history is the first resource root, immediately below the
  // standing New session action and before the Commons.
  'sessions',
  'commons',
  'projects',
  'task-partners',
  'artifacts',
  'contexts',
  'models',
  'agents',
  'scheduled',
  'discussions',
  'messages',
  'notifications',
  'dispatch',
  'customize',
  'admin',
]

// The section child registry lives in the pure `./subviews` module (no lucide
// import), so a node --test can import it directly — re-exported here for callers
// that already reach for section metadata.
export { SECTION_CHILDREN, SECTION_SUBVIEWS, type SectionChild, type SubView } from './subviews'
