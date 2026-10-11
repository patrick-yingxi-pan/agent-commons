import type { McpStdioSetupState } from '../controller/mcpStdioSetupCore.ts'
const copy: Record<McpStdioSetupState['phase'], string> = {
  preparing: 'Preparing native review. No program has been approved yet.',
  authorizing: 'Waiting for native approval and catalog inspection…',
  working: 'Native setup is still running. Check status reads only; it does not start another inspection.',
  checking: 'Checking the exact saved inspection status…',
  cancelling: 'Stopping local setup. Work already performed cannot be undone.',
  uncertain: 'Inspection may have started, but its outcome is not confirmed. Check status reads only; it never starts another inspection.',
  connected: 'Catalog inspection recorded. Each conversation tool call still requires separate approval.',
  disconnected: 'The inspection was recorded, but this connection is now disconnected.',
  cancelled: 'Setup was cancelled before inspection was submitted.',
  failed: 'Setup did not complete. Review the current connection before starting a new native approval.',
}
export function McpStdioSetupStatus({ state }: { state: McpStdioSetupState }) {
  return <p data-mcp-stdio-phase={state.phase} role={state.error || state.phase === 'uncertain' || state.phase === 'failed' ? 'alert' : 'status'} className={`text-[12px] leading-relaxed ${state.error || state.phase === 'failed' ? 'text-danger-text' : 'text-ink-soft'}`}>{state.error ?? copy[state.phase]}</p>
}
