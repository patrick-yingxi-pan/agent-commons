import { useMcpInputAttempts, mcpInputHeld, setMcpInputHeld, mcpInputKey, type McpInputAttempt } from '../controller/mcpInputState.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { Spinner } from './Spinner.tsx'

/** Always-mounted, lazy-command recovery. No answer text enters shell copy. */
export function McpInputMutationNotice() {
  const attempts = useMcpInputAttempts()
  if (!attempts.length) return null
  const recover = async (attempt: McpInputAttempt, action: 'checkMcpInput' | 'reviewLatestMcpInput') => {
    try { await (await import('../controller/mcpInputMutations.ts'))[action](attempt.scope) }
    catch {
      const current = mcpInputHeld(attempt.scope)
      if (current?.attempt === attempt) setMcpInputHeld(attempt.scope, { ...current, attempt: { ...attempt,
        error: 'Couldn’t load recovery controls. Copy unsent work before reloading the app. Nothing was sent again.' } })
    }
  }
  return <div data-mcp-input-recovery className="relative z-[60] shrink-0 border-b border-line bg-panel-2/95 px-2 pt-2">
    {attempts.map((attempt) => {
      const busy = attempt.state === 'submitting' || attempt.state === 'checking'
      const pending = attempt.receipt?.activity.status === 'running'
      const review = mcpInputHeld(attempt.scope)?.review
      const message = attempt.error ?? (attempt.state === 'submitting'
        ? attempt.command.action === 'stop' ? 'Recording local stop…' : 'Sending reviewed tool response once…'
        : attempt.state === 'checking' ? 'Reading saved tool response status…'
          : attempt.state === 'uncertain' ? 'Tool response not confirmed. Check status reads its receipt; Review latest discards local answers only after a fresh read. Neither sends again.'
            : pending ? 'Tool response recorded; the tool is still running. Check status reads only.'
              : 'Tool response recorded. Review latest to see the next form or finish recovery.')
      return <div key={mcpInputKey(attempt.scope)} data-mcp-input-attempt={attempt.state}
        role="group" aria-label={`Tool response recovery · ${review?.connectionLabel ?? 'MCP'} · ${review?.toolName ?? attempt.scope.activityId} · round ${attempt.command.round}`}>
        <p className="mb-1 break-words px-3 text-center text-[11px] text-ink-soft [overflow-wrap:anywhere]">
          {review?.connectionLabel ?? 'MCP'} · {review?.toolName ?? attempt.scope.activityId} · round {attempt.command.round}
        </p>
        <InlineOperationStatus tone={attempt.state === 'uncertain' || attempt.error ? 'alert' : 'status'} message={message}
          leading={busy ? <Spinner size={12} /> : undefined}
          action={busy ? undefined : { label: 'Check status', onClick: () => { void recover(attempt, 'checkMcpInput') } }}
          secondaryAction={busy ? undefined : { label: 'Review latest', onClick: () => { void recover(attempt, 'reviewLatestMcpInput') } }} />
      </div>
    })}
  </div>
}
