/** A tiny persisted store for the "Don't ask again" decisions on the
 *  context-dependency prompts (a GitHub-remote repo ⇄ the GitHub connector).
 *
 *  Each key remembers the *decision* the user made, not just "skip":
 *    - 'attachRepoOnFolder'      → 'always' | 'never'   (a git folder: attach the repo too?)
 *    - 'linkOnAttach'            → 'always' | 'never'   (add the connector with the repo?)
 *    - 'cascadeRepoRemove'       → 'both'   | 'keep'    (remove the orphaned connector too?)
 *    - 'cascadeConnectorRemove'  → 'all'    | 'keep'    (remove dependent repos too?)
 *
 *  Absent (or any other value) means "ask". Cancel is never remembered. */
const KEY = 'claude-ui.deps.v1'

type Store = Record<string, string>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

export function getDecision(key: string): string | undefined {
  return load()[key]
}

export function setDecision(key: string, value: string) {
  const next = { ...load(), [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
