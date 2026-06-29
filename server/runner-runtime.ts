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
import { fsReader } from './fs.ts'
import { RUNNER_FS_ROOTS } from './data/runners.ts'

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

/** Does a single granted scope cover `target`? `*` grants everything; otherwise an
 *  exact match or a path/command *under* the scope (`scope` then a `/` boundary),
 *  so `~/projects` grants `~/projects/app` but not `~/projects-secret`. */
export function scopeMatches(scope: string, target: string): boolean {
  if (scope === '*') return true
  if (scope === target) return true
  return target.startsWith(scope.endsWith('/') ? scope : `${scope}/`)
}

/** Is `target` within *any* of the runner's granted scopes for `capability`?
 *  False when the runner doesn't advertise the capability at all. */
export function isGranted(runner: Runner, capability: CapabilityRequest['capability'], target: string): boolean {
  const cap = runner.capabilities.find((c) => c.type === capability)
  return !!cap && cap.scopes.some((s) => scopeMatches(s, target))
}

/** A seeded runner's logical `target` resolved to a real path under its on-disk
 *  root: strip the matched scope prefix (`~/projects/…` → `…`) and read from the
 *  runner's `RUNNER_FS_ROOTS` directory. `undefined` when the runner has no mapped
 *  root (an ad-hoc runner that connected at runtime) — the caller falls back to a
 *  deterministic mock so a real read isn't required to demo the wire shape. */
function realFs(runner: Runner, capability: 'fs.read' | 'fs.list', target: string) {
  const root = RUNNER_FS_ROOTS[runner.id]
  if (!root) return undefined
  const cap = runner.capabilities.find((c) => c.type === capability)
  const scope = cap?.scopes.find((s) => scopeMatches(s, target))
  // Express the target relative to the matched scope root (the runner's real dir).
  const rel = !scope || scope === '*' ? target.replace(/^[~/]+/, '') : target.slice(scope.length).replace(/^\/+/, '')
  return { reader: fsReader(root), rel }
}

/** Fulfilment per capability. Read-only fs (`fs.read` / `fs.list`) hits the real
 *  filesystem under the runner's mapped root (deterministic mock fallback for an
 *  unmapped runner); the rest stay mock — deterministic, real-shaped output. */
function fulfil(runner: Runner, request: CapabilityRequest): unknown {
  switch (request.capability) {
    case 'fs.read': {
      const fs = realFs(runner, 'fs.read', request.target)
      const got = fs?.reader.readText(fs.rel)
      if (got?.kind === 'text') return { encoding: 'utf-8', content: got.text ?? '' }
      if (got?.kind === 'image' || got?.kind === 'binary') {
        return { encoding: 'binary', contentType: got.contentType, note: 'use /fs/content for bytes' }
      }
      return { encoding: 'utf-8', content: `// mock contents of ${request.target}\n` }
    }
    case 'fs.list': {
      const fs = realFs(runner, 'fs.list', request.target)
      const listed = fs ? (fs.rel ? fs.reader.folderContents(fs.rel) : { artifacts: fsRootEntries(fs.reader) }) : undefined
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
function fsRootEntries(reader: ReturnType<typeof fsReader>) {
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
