/** Seed runners. In native/mock mode the backend behaves like a co-located
 *  sidecar, so we seed a single local runner — the "degenerate one-runner registry"
 *  the static capabilities describe (see docs/capability-broker-architecture.md).
 *  A remote web server (`BACKEND=remote`) has no co-located host, so it seeds
 *  none, mirroring how the native routes report unavailable there. */
import { join } from 'node:path'
import type { RegisterInput } from '../registry.ts'

/** The runner's advertised fs scope — the logical root the host grants. Used as the
 *  `scopes` label AND (resolved to a real directory below) the path the served
 *  filesystem reader actually reads. */
const RUNNER_SCOPE = '~/projects'

export const LOCAL_RUNNER_SEED: RegisterInput = {
  id: 'runner-local',
  label: "Patrick's Mac",
  host: 'localhost',
  capabilities: [
    { type: 'fs.read', scopes: [RUNNER_SCOPE] },
    // The read-only discovery half of fs.read — lets the picker browse this host
    // before attaching (contract/fs.ts; contract/agents.ts isMonotonic).
    { type: 'fs.list', scopes: [RUNNER_SCOPE] },
    { type: 'fs.write', scopes: [RUNNER_SCOPE] },
    { type: 'terminal', scopes: ['*'] },
    { type: 'process', scopes: ['*'] },
  ],
}

/** Server-only map: a seeded runner id → the REAL on-disk directory the broker
 *  reads when serving / fulfilling that runner's `fs.*` capabilities. NOT on the
 *  contract — the runner's advertised `scopes` (above) are logical labels; this is
 *  how the prototype's in-process broker turns one into actual bytes. Defaults to
 *  the in-repo `sample-runner-host/` tree (deterministic, reviewable); override the
 *  co-located runner's root with `CONTEXT_RUNNER_ROOT`. */
export const RUNNER_FS_ROOTS: Record<string, string> = {
  [LOCAL_RUNNER_SEED.id]: process.env.CONTEXT_RUNNER_ROOT ?? join(process.cwd(), 'sample-runner-host'),
}
