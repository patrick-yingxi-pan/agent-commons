/** ── The connector install recipes, per shell (spec MODEL-14) ─────────────────
 *  ONE source of truth for the copyable "install the connector" command the mint
 *  panel shows — in every shell dialect we hand out. A single bash-only string
 *  breaks silently off-platform: in PowerShell `curl` is an alias for
 *  Invoke-WebRequest (`-fsSL` is a binding error), PowerShell 5.1 has no `&&` and
 *  no bash subshell, and `>/dev/null 2>&1` isn't how its streams silence. So each
 *  dialect gets its own carefully-shaped recipe, and the panel offers both.
 *
 *  Every dialect must preserve the recipe's three safety properties (the reasons
 *  live in docs/delegated-cognition-provider.md §4.2, locked by
 *  tests/connector-serve.test.ts):
 *   1. download to a temp file, rename on success — a dropped re-download can't
 *      truncate the file a working registration points at (POSIX: `&&` + `mv`;
 *      PowerShell: `if ($?)` + `Move-Item -Force`);
 *   2. remove-first guard, fully silenced — `claude mcp add` refuses an existing
 *      name, so blind copy-paste must be idempotent and the first run mustn't
 *      look like it errored (POSIX: `>/dev/null 2>&1`; PowerShell: `*> $null`);
 *   3. both sides pinned `-s local` — never wedge on or relocate a user-/
 *      project-scope install.
 */

export type ShellId = 'posix' | 'powershell'

export interface InstallRecipe {
  id: ShellId
  /** Short pill label for the shell toggle. */
  label: string
  command: string
}

export function installRecipes(connectorUrl: string): InstallRecipe[] {
  return [
    {
      id: 'posix',
      label: 'bash / zsh',
      command: `curl -fsSL ${connectorUrl} -o ~/session-relay.mjs.tmp && mv ~/session-relay.mjs.tmp ~/session-relay.mjs && (claude mcp remove -s local session-relay >/dev/null 2>&1; claude mcp add -s local session-relay -- node ~/session-relay.mjs)`,
    },
    {
      id: 'powershell',
      label: 'PowerShell',
      // curl.exe on purpose: bare `curl` is the Invoke-WebRequest alias in PowerShell.
      command: `curl.exe -fsSL ${connectorUrl} -o "$HOME\\session-relay.mjs.tmp"; if ($?) { Move-Item -Force "$HOME\\session-relay.mjs.tmp" "$HOME\\session-relay.mjs"; claude mcp remove -s local session-relay *> $null; claude mcp add -s local session-relay -- node "$HOME\\session-relay.mjs" }`,
    },
  ]
}

/** Pre-select the dialect the viewer's own machine most likely wants (a pure UI
 *  convenience — both recipes stay one click away). `navigator.platform` is
 *  'Win32' on Windows; anchored so 'darwin' can't match. */
export function defaultShellId(platform: string): ShellId {
  return /^win/i.test(platform) ? 'powershell' : 'posix'
}
