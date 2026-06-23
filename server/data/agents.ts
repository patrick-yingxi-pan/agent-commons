/** Seed agents. In native/mock mode the backend behaves like a co-located
 *  sidecar, so we seed a single local agent — the "degenerate one-agent registry"
 *  the static capabilities describe (see docs/capability-broker-architecture.md).
 *  A remote web server (`BACKEND=remote`) has no co-located host, so it seeds
 *  none, mirroring how the native routes report unavailable there. */
import type { RegisterInput } from '../registry.ts'

export const LOCAL_AGENT_SEED: RegisterInput = {
  id: 'agent-local',
  label: 'This Mac',
  host: 'localhost',
  capabilities: [
    { type: 'fs.read', scopes: ['~/projects'] },
    { type: 'fs.write', scopes: ['~/projects'] },
    { type: 'terminal', scopes: ['*'] },
    { type: 'process', scopes: ['*'] },
  ],
}
