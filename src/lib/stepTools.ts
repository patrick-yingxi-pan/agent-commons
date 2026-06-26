import type { StepTool } from '../../contract/cowork.ts'

/** The tools a workflow step can use — the step editor's tool-picker options.
 *  Mirrors the server seed's TOOL set (server/data/cowork.ts) and the page's
 *  STEP_TOOL_ICON map: a pure reasoning step (Claude), a built-in (web search),
 *  opening a session, and the common connectors. Linear carries `needsAuth` to
 *  match its expired state elsewhere in the demo. */
export const STEP_TOOLS: StepTool[] = [
  { id: 'claude', label: 'Claude', tone: 'claude' },
  { id: 'web', label: 'Web search', tone: 'web' },
  { id: 'session', label: 'New session', tone: 'workspace' },
  { id: 'github', label: 'GitHub', tone: 'connector' },
  { id: 'slack', label: 'Slack', tone: 'connector' },
  { id: 'linear', label: 'Linear', tone: 'connector', needsAuth: true },
  { id: 'gmail', label: 'Gmail', tone: 'connector' },
  { id: 'gdrive', label: 'Google Drive', tone: 'connector' },
  { id: 'notion', label: 'Notion', tone: 'connector' },
  { id: 'amplitude', label: 'Amplitude', tone: 'connector' },
  { id: 'sentry', label: 'Sentry', tone: 'connector' },
]
