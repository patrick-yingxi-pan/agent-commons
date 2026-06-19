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

/** The per-type color of an attached-context chip, so each context type is its
 *  own hue. Workspaces/Repositories reuse the capability colors (so a chip
 *  matches its badge and panel); connectors/MCP/files/photos get their own. */
export type ChipTone = 'workspace' | 'repo' | 'connector' | 'mcp' | 'file' | 'photo'

export const CHIP_TONES: Record<ChipTone, { tint: string; color: string }> = {
  workspace: { tint: 'bg-cap-workspace-tint', color: 'text-cap-workspace' },
  repo: { tint: 'bg-cap-repo-tint', color: 'text-cap-repo' },
  connector: { tint: 'bg-cap-connector-tint', color: 'text-cap-connector' },
  mcp: { tint: 'bg-cap-mcp-tint', color: 'text-cap-mcp' },
  file: { tint: 'bg-cap-file-tint', color: 'text-cap-file' },
  photo: { tint: 'bg-cap-photo-tint', color: 'text-cap-photo' },
}
