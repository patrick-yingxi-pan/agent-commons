/** The per-type color of an attached-context chip, so each context type is its
 *  own hue. Workspaces/Repositories reuse the capability colors (so a chip
 *  matches its panel); connectors/MCP/files/photos get their own. */
export type ChipTone = 'workspace' | 'repo' | 'connector' | 'mcp' | 'file' | 'photo'

export const CHIP_TONES: Record<ChipTone, { tint: string; color: string }> = {
  workspace: { tint: 'bg-cap-workspace-tint', color: 'text-cap-workspace' },
  repo: { tint: 'bg-cap-repo-tint', color: 'text-cap-repo' },
  connector: { tint: 'bg-cap-connector-tint', color: 'text-cap-connector' },
  mcp: { tint: 'bg-cap-mcp-tint', color: 'text-cap-mcp' },
  file: { tint: 'bg-cap-file-tint', color: 'text-cap-file' },
  photo: { tint: 'bg-cap-photo-tint', color: 'text-cap-photo' },
}
