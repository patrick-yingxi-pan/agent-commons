/** ── Contract: cross-user isolation (D12) ───────────────────────────────────
 *  The make-or-break property of Agent Commons (docs/agent-commons.md, D12): a
 *  commissioned Agent executes under **attenuated, Project-scoped authority** — the
 *  connectors / scopes the *Project* admits — **never its owner's ambient account set**.
 *  So a Project artifact authored by one user (mechanically untrusted, LLM-read input)
 *  cannot become a channel that reaches another Contributor's accounts: the authority an
 *  injected instruction could reach is bounded by what the Project exposes, attenuated
 *  by the commission's grant.
 *
 *  The effective authority a Contributor carries onto a Project is
 *  `intersectAuthority(what-the-agent-was-granted, projectAdmittedAuthority(project))`
 *  — the owner's ambient set is the *ceiling* (D8), the Project's admitted set the
 *  *wall* (D12). Default-deny: a connector the Project doesn't admit is unreachable even
 *  to an Agent granted everything. */
import type { Authority } from './authority.ts'
import type { ProjectContext } from './cowork.ts'

/** What a Project admits, derived from its attached contexts. A Project gates **data
 *  access** (which connectors, which file-scopes), not which tools an Agent may use —
 *  tools are the Agent's own capability — so `tools` is left unrestricted. Connectors
 *  come from the Project's connector contexts; scopes from its folder + repo contexts.
 *  These labels are the connector / scope identity at the Project boundary. */
export function projectAdmittedAuthority(contexts: ProjectContext[]): Authority {
  const labelsOf = (kinds: ProjectContext['kind'][]) =>
    contexts.filter((c) => kinds.includes(c.kind)).map((c) => c.label)
  return {
    // A Project does not restrict which tools an Agent runs — only the data it reaches.
    connectors: labelsOf(['connector']),
    scopes: labelsOf(['folder', 'repo']),
  }
}
