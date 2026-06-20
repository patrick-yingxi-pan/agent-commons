import { Box, Briefcase, Cable, Clock, SendHorizontal, Shapes } from 'lucide-react'
import type { SectionId } from '../types'

/** The cross-cutting tools in the sidebar nav. One source of truth for the
 *  label / icon so the nav row and the section header always match. */
export const SECTION_META: Record<
  SectionId,
  { label: string; subtitle: string; Icon: typeof Box; beta?: boolean }
> = {
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
  scheduled: {
    label: 'Scheduled',
    subtitle: 'Tasks Claude runs for you on a cadence.',
    Icon: Clock,
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
}

export const SECTION_ORDER: SectionId[] = [
  'projects',
  'artifacts',
  'contexts',
  'scheduled',
  'dispatch',
  'customize',
]
