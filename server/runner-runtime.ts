/** ── The (mock) runner runtime ───────────────────────────────────────────────
 *  Stands in for the on-host runner's executor. In the real architecture this code
 *  runs *inside the runner* on its host, not in the broker — which is why grant
 *  enforcement lives here, not in the route: the runner, never the broker, is the
 *  policy-enforcement point (D3). The broker (the route) only routes; this module
 *  enforces the scoped grant and then fulfils the capability.
 *
 *  Fulfilment is mock (deterministic, reviewable) but the wire shape is real —
 *  the same seam a production runner would implement against its host. */
import type { Runner, CapabilityRequest, CapabilityResult } from '../contract/index.ts'
import type { FsReader } from './fs.ts'
import { runnerFs } from './runnerFs.ts'
import { scopeMatches } from './runnerScopes.ts'
export { scopeMatches, isGranted } from './runnerScopes.ts'

/** A capability invocation that the runner refused or couldn't run. `code` maps to
 *  the contract error envelope so the route can surface it verbatim. */
export class CapabilityError extends Error {
  readonly code: 'capability_unavailable' | 'forbidden' | 'bad_request'
  constructor(code: 'capability_unavailable' | 'forbidden' | 'bad_request', message: string) {
    super(message)
    this.code = code
    this.name = 'CapabilityError'
  }
}

/** Fulfilment per capability. Read-only fs (`fs.read` / `fs.list`) hits the real
 *  filesystem under the runner's mapped root (deterministic mock fallback for an
 *  unmapped runner); the rest stay mock — deterministic, real-shaped output. */
function fulfil(runner: Runner, request: CapabilityRequest): unknown {
  switch (request.capability) {
    case 'fs.read': {
      const fs = runnerFs(runner)
      // An unmapped development runner has no host fulfilment and retains the
      // deterministic mock. A mapped runner, however, must never turn a real
      // missing/refused read into a successful fake effect.
      if (!fs) return { encoding: 'utf-8', content: `// mock contents of ${request.target}\n` }
      const rel = fs.relativeTarget(request.target)
      const got = rel === undefined ? undefined : fs.reader.readText(rel)
      if (got?.kind === 'text') return { encoding: 'utf-8', content: got.text ?? '' }
      if (got?.kind === 'image' || got?.kind === 'binary') {
        return { encoding: 'binary', contentType: got.contentType, note: 'use /fs/content for bytes' }
      }
      throw new CapabilityError('capability_unavailable', `Runner '${runner.id}' could not read '${request.target}'`)
    }
    case 'fs.list': {
      const fs = runnerFs(runner)
      const rel = fs?.relativeTarget(request.target)
      const listed = fs && rel !== undefined ? (rel ? fs.reader.folderContents(rel) : { artifacts: fsRootEntries(fs.reader) }) : undefined
      if (fs && !listed) {
        throw new CapabilityError('capability_unavailable', `Runner '${runner.id}' could not list '${request.target}'`)
      }
      return { entries: listed?.artifacts?.map((a) => ({ name: a.name, kind: a.kind })) ?? [] }
    }
    case 'fs.write': {
      const content = typeof request.args?.content === 'string' ? request.args.content : ''
      return { written: true, bytes: content.length, target: request.target }
    }
    case 'terminal':
      return { stdout: `mock$ ${request.target}\n(ran on runner)\n`, exitCode: 0 }
    case 'process':
      return { started: true, target: request.target }
    default:
      throw new CapabilityError('bad_request', `Unknown capability '${request.capability}'`)
  }
}

/** Top-level entries of a reader as `{name, kind}`-shaped artifacts (for `fs.list`
 *  at the scope root, where there's no sub-folder path to scan). */
function fsRootEntries(reader: FsReader) {
  const { files, photos, folders } = reader.list()
  return [
    ...folders.map((d) => ({ name: d.name, kind: 'doc' as const })),
    ...files.map((f) => ({ name: f.name, kind: f.kind })),
    ...photos.map((p) => ({ name: p.name, kind: 'image' as const })),
  ]
}

/** Run a capability on this runner's host. Enforces the grant first (D3), then
 *  fulfils. Throws CapabilityError on an unsupported capability or a target
 *  outside the granted scope — the route maps it to the error envelope. The
 *  caller (broker) is expected to have already confirmed the runner is online. */
export function runCapability(runner: Runner, request: CapabilityRequest): CapabilityResult {
  const cap = runner.capabilities.find((c) => c.type === request.capability)
  if (!cap) {
    throw new CapabilityError(
      'capability_unavailable',
      `Runner '${runner.id}' does not offer '${request.capability}'`,
    )
  }
  if (!cap.scopes.some((s) => scopeMatches(s, request.target))) {
    throw new CapabilityError(
      'forbidden',
      `'${request.target}' is outside the granted scope for '${request.capability}' on '${runner.id}'`,
    )
  }
  return {
    capability: request.capability,
    runnerId: runner.id,
    target: request.target,
    output: fulfil(runner, request),
  }
}
