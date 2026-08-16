import { Bell, Bot, Box, Briefcase, Cable, Clock, Cpu, Mail, MessageSquareText, MessagesSquare, Newspaper, SendHorizontal, Shapes, Wrench } from 'lucide-react'
import type { SectionId } from '../types'

/** The cross-cutting tools in the sidebar nav. One source of truth for the
 *  label / icon so the nav row and the section header always match. */
export const SECTION_META: Record<
  SectionId,
  { label: string; subtitle: string; Icon: typeof Box; beta?: boolean }
> = {
  commons: {
    label: 'Commons',
    subtitle: 'What your world shares — published resources, their threads, and what just landed.',
    Icon: Newspaper,
  },
  projects: {
    label: 'Projects',
    subtitle: 'Group related work and the context it shares.',
    Icon: Box,
  },
  artifacts: {
    label: 'Artifacts',
    subtitle: 'Every document, deck, sheet, and image you’ve made.',
    Icon: Shapes,
  },
  contexts: {
    label: 'Contexts',
    subtitle: 'Accounts, servers, and repos you’ve set up once and reuse across sessions.',
    Icon: Cable,
  },
  models: {
    label: 'Models',
    subtitle: 'The models your sessions run on — built-in Claude, endpoints you register, and your own delegated sessions.',
    Icon: Cpu,
  },
  agents: {
    label: 'Agents',
    subtitle: 'Worker agents, the prompts they start from, and where they’re commissioned.',
    Icon: Bot,
  },
  scheduled: {
    label: 'Routines',
    subtitle: 'Recurring workflows Claude runs for you on a cadence.',
    Icon: Clock,
  },
  discussions: {
    label: 'Discussions',
    subtitle: 'Threads on the resources you share and follow.',
    Icon: MessagesSquare,
  },
  // S7 — the DM inbox. A message IS a discussion anchored to a person, so this
  // section and Discussions render the same entity; they are two sections
  // because they are two reading modes (talk about things vs talk with people)
  // and the server lists each row in exactly one of them.
  messages: {
    label: 'Messages',
    subtitle: 'Direct conversations with the people you can reach.',
    Icon: Mail,
  },
  // The inbox (D24). A PAGE, not the overlay it began as (owner directive
  // 2026-08-08): what happened while you weren't looking is a list you triage,
  // and a modal is only for a transient act. As a page it gets an address, a
  // place in the back stack, and a pane of its own like everything else — which
  // is what makes "answer a bell, come back for the next one" work at all.
  notifications: {
    label: 'Notifications',
    subtitle: 'What happened to what you own, watch, or posted — while you weren’t looking.',
    Icon: Bell,
  },
  sessions: {
    label: 'Sessions',
    subtitle: 'Your conversations with Claude, ready to resume or organize.',
    Icon: MessageSquareText,
  },
  dispatch: {
    label: 'Dispatch',
    subtitle: 'Send Claude off to run tasks in the background.',
    Icon: SendHorizontal,
    beta: true,
  },
  customize: {
    label: 'Customize',
    subtitle: 'Make the workspace yours.',
    Icon: Briefcase,
  },
  // The maintainer console — rail row rendered ONLY for principals whose
  // Identity carries `instanceAdmin` (the MAINTAINERS env allowlist); the
  // server's 404 wall is the gate, this visibility is chrome.
  admin: {
    label: 'Maintain',
    subtitle: 'Instance administration for website maintainers.',
    Icon: Wrench,
  },
}

export const SECTION_ORDER: SectionId[] = [
  'commons',
  'projects',
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
  // Sessions is an ordinary resource root. It is last so the default generic
  // rail split can isolate it in the lower pane without inventing a second
  // hierarchy or a special-purpose utility container.
  'sessions',
]

// The section sub-view registry lives in the pure `./subviews` module (no lucide
// import), so a node --test can import it directly — re-exported here for callers
// that already reach for section metadata.
export { SECTION_SUBVIEWS, type SubView } from './subviews'
