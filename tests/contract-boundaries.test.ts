/** Boundary contracts enforced as tests — the structural invariants that keep the
 *  UI ↔ backend seam honest, the class of drift an adversarial review caught by hand:
 *
 *   • the contract stays framework-/Node-free (so both ends import it verbatim),
 *   • contract + server stay erasable TS (the Node runtime only type-strips),
 *   • every declared SSE event has BOTH a server producer and a client consumer
 *     (no dead/reserved wire surface, no unhandled event),
 *   • every `*Request` DTO the contract declares is actually used by a route/command.
 *
 *  These read the repo's own source as data (see tests/helpers/source.ts). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROOT, filesUnder, read, stripComments, concatSource } from './helpers/source.ts'
import { join } from 'node:path'

// ── The contract is portable: framework-free and Node-free ───────────────────
test('contract/ imports only other contract modules — no React, no node:, no UI deps', () => {
  const offenders = []
  for (const file of filesUnder('contract')) {
    const src = stripComments(read(file))
    for (const m of src.matchAll(/\bfrom\s+'([^']+)'/g)) {
      const spec = m[1]
      const ok = spec.startsWith('./') || spec.startsWith('../contract/')
      if (!ok) offenders.push(`${file.replace(ROOT, '')} imports '${spec}'`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `contract/*.ts must import only sibling contract modules (it is imported verbatim by ` +
      `both the Vite UI and the Node server): ${offenders.join('; ')}`,
  )
})

// ── The Node runtime only type-strips: contract + server must be erasable TS ──
test('contract/ + server/ use only erasable TypeScript (no enum / namespace / param-property / decorator)', () => {
  const offenders = []
  for (const dir of ['contract', 'server']) {
    for (const file of filesUnder(dir)) {
      const src = stripComments(read(file))
      const rel = file.replace(ROOT, '')
      if (/\benum\s+[A-Za-z_]/.test(src)) offenders.push(`${rel}: enum`)
      if (/\bnamespace\s+[A-Za-z_]/.test(src)) offenders.push(`${rel}: namespace`)
      if (/constructor\s*\([^)]*\b(?:private|public|protected|readonly)\s+[A-Za-z_]/.test(src))
        offenders.push(`${rel}: constructor parameter property`)
      if (/^\s*@[A-Za-z_]\w*/m.test(src)) offenders.push(`${rel}: decorator`)
    }
  }
  assert.deepEqual(offenders, [], `non-erasable syntax breaks the type-stripping Node runtime: ${offenders.join('; ')}`)
})

// ── The SSE event boundary: every declared event is produced AND consumed ─────
function declaredEvents() {
  const events = stripComments(read(join(ROOT, 'contract', 'events.ts')))
  return [...new Set([...events.matchAll(/\btype:\s*'([^']+)'/g)].map((m) => m[1]))]
}

test('every ServerEvent the contract declares has a server producer and a client-router consumer', () => {
  const declared = declaredEvents()
  assert.ok(declared.length >= 15, `expected the full event union; parsed only ${declared.length}`)

  const server = concatSource('server')
  // Ambient events route through src/api/events.ts; reply-stream events through the
  // send dispatch in src/api/commands.ts. Together they must cover the whole union.
  const routers =
    stripComments(read(join(ROOT, 'src', 'api', 'events.ts'))) +
    '\n' +
    stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))

  const noProducer = declared.filter((t) => !server.includes(`'${t}'`))
  assert.deepEqual(noProducer, [], `declared events with NO server producer (dead/reserved wire surface): ${noProducer.join(', ')}`)

  const noConsumer = declared.filter((t) => !routers.includes(`case '${t}'`))
  assert.deepEqual(noConsumer, [], `declared events the client router never handles: ${noConsumer.join(', ')}`)
})

test('the client routers handle no event the ServerEvent contract does not declare (no stale handler)', () => {
  const declared = new Set(declaredEvents())
  const routers =
    stripComments(read(join(ROOT, 'src', 'api', 'events.ts'))) +
    '\n' +
    stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const handled = [...new Set([...routers.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]))]
  const undeclared = handled.filter((t) => !declared.has(t))
  assert.deepEqual(undeclared, [], `client router cases absent from the ServerEvent union: ${undeclared.join(', ')}`)
})

// ── The HTTP boundary: every declared request DTO is actually wired ──────────
test('every *Request DTO in the contract is referenced by a route or command (no dead wire types)', () => {
  const contractSrc = concatSource('contract')
  const names = [...new Set([...contractSrc.matchAll(/export interface (\w+Request)\b/g)].map((m) => m[1]))]
  assert.ok(names.length >= 10, `expected the request DTOs; parsed only ${names.length}`)

  const usage = concatSource('server') + '\n' + concatSource('src')
  const unused = names.filter((name) => !usage.includes(name))
  assert.deepEqual(unused, [], `request DTOs declared but used by neither end (drift from the inline body types): ${unused.join(', ')}`)
})
