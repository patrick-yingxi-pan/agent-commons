import { GitBranch, MessagesSquare, PanelsTopLeft, type LucideIcon } from 'lucide-react'
import type { Capability } from '../types'

interface CapMeta {
  label: string
  /** The old tab name this capability used to be siloed inside. */
  legacyTab: string
  Icon: LucideIcon
  /** Tailwind text color utility backed by a theme token. */
  color: string
  /** Tailwind bg tint utility. */
  tint: string
}

export const CAP_META: Record<Capability, CapMeta> = {
  chat: {
    label: 'Chat',
    legacyTab: 'Chat',
    Icon: MessagesSquare,
    color: 'text-cap-chat',
    tint: 'bg-panel-2',
  },
  workspace: {
    label: 'Workspace',
    legacyTab: 'Cowork',
    Icon: PanelsTopLeft,
    color: 'text-cap-workspace',
    tint: 'bg-cap-workspace-tint',
  },
  repo: {
    label: 'Repo',
    legacyTab: 'Code',
    Icon: GitBranch,
    color: 'text-cap-repo',
    tint: 'bg-cap-repo-tint',
  },
}

export const CAP_ORDER: Capability[] = ['chat', 'workspace', 'repo']
