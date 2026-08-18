/** Cross-layer access parity (INV-11).
 *
 * The UI surface is DERIVED from calls through its one API funnel; it is not a
 * hand-kept allowlist. The two machine surfaces are derived from the live route
 * table. Comparing the resulting operation identities in both directions is
 * the lock that turns "UI, in-session, and remote MCP are equivalent" from a
 * review promise into a structural invariant. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'
import { buildRouter } from '../server/routes/index.ts'
import { catalogOf } from '../server/apiSurface.ts'
import { mcpToolRoutes } from '../server/mcp.ts'
import { deriveApiTools } from '../server/model/apiTools.ts'
import { paths } from '../src/api/keys.ts'
import { filesUnder, read } from './helpers/source.ts'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const routeKey = (method: string, pattern: string) => `${method} ${pattern}`
const router = buildRouter()
const catalog = catalogOf(router)

function routeRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment === '*' ? '.*' : segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^/${escaped}$`)
}

/** Match a UI path-builder to the route it addresses. Query strings are form,
 * not operation identity; route specificity resolves static-vs-parameterized
 * candidates deterministically. */
function operationFor(method: Method, pathName: string): string {
  const value = (paths as Record<string, unknown>)[pathName]
  assert.notEqual(value, undefined, `paths.${pathName} exists`)
  const concrete = typeof value === 'function'
    ? String((value as (...args: unknown[]) => unknown)(...'sample sample sample sample sample'.split(' ')))
    : String(value)
  const pathname = new URL(concrete, 'http://ui.internal').pathname
  const matches = catalog
    .filter((op) => op.method === method && routeRegex(op.pattern).test(pathname))
    .sort((a, b) => {
      const staticA = a.pattern.split('/').filter((s) => s && !s.startsWith(':') && s !== '*').length
      const staticB = b.pattern.split('/').filter((s) => s && !s.startsWith(':') && s !== '*').length
      return staticB - staticA
    })
  assert.ok(matches.length > 0, `${method} paths.${pathName} (${pathname}) matches a live route`)
  return routeKey(method, matches[0].pattern)
}

const apiMethods = new Map<string, Method>([
  ['apiGet', 'GET'],
  ['apiUrl', 'GET'],
  ['apiPost', 'POST'],
  ['apiPatch', 'PATCH'],
  ['apiDelete', 'DELETE'],
])

/** The shipped module graph, rooted at the real browser entry. A component file
 * that exists but is no longer imported cannot prove UI reachability. */
function reachableUiFiles(): Set<string> {
  const files = filesUnder('src')
  const byPath = new Map(files.map((file) => [normalize(file), file]))
  const entry = files.find((file) => file.replaceAll('\\', '/').endsWith('/src/main.tsx'))
  assert.ok(entry, 'the shipped UI entry src/main.tsx exists')
  const reached = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (reached.has(file)) continue
    reached.add(file)
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue
      const base = join(dirname(file), specifier.text)
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
        .map((candidate) => byPath.get(normalize(candidate)))
        .find((candidate): candidate is string => candidate !== undefined)
      if (target) queue.push(target)
    }
  }
  assert.ok(reached.size > 80, `the shipped import graph must be substantive; found only ${reached.size} files`)
  return reached
}

const reachableFiles = reachableUiFiles()

/** Which API exports are actually imported by shipped UI/controller code. This
 * closes the "dead wrapper proves a capability" loophole: an unused command
 * containing apiPost is not something the UI can do. */
function usedApiExports(): Set<string> {
  const used = new Set<string>()
  for (const file of reachableFiles) {
    const normalized = file.replaceAll('\\', '/')
    if (normalized.includes('/src/api/')) continue
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const spec = statement.moduleSpecifier.text
      if (!/(^|\/)api(?:\/(?:hooks|commands|client|keys))?(?:\.ts)?$/.test(spec)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const entry of bindings.elements) used.add(entry.propertyName?.text ?? entry.name.text)
    }
  }
  assert.ok(used.size > 40, `UI reachability discovery must find the API consumers; found only ${used.size}`)
  return used
}

function accessDeclarations(source: ts.SourceFile, exportsOnly: boolean): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>()
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && (!exportsOnly || exported(statement))) {
      found.set(statement.name.text, statement)
    } else if (ts.isVariableStatement(statement) && (!exportsOnly || exported(statement))) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) found.set(declaration.name.text, declaration.initializer)
      }
    }
  }
  return found
}

const pathsIn = (node: ts.Node): Set<string> => {
  const found = new Set<string>()
  const collect = (candidate: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      candidate.expression.text === 'paths'
    ) found.add(candidate.name.text)
    ts.forEachChild(candidate, collect)
  }
  collect(node)
  return found
}

const methodsIn = (node: ts.Node): Set<Method> => {
  const methods = new Set<Method>()
  const collect = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) {
      const direct = apiMethods.get(candidate.expression.text)
      if (direct) methods.add(direct)
      if (candidate.expression.text === 'fetch') {
        const options = candidate.arguments[1]
        if (options && ts.isObjectLiteralExpression(options)) {
          const methodProperty = options.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method',
          )
          if (methodProperty) {
            const literals = (part: ts.Node): void => {
              if (ts.isStringLiteral(part) && ['GET', 'POST', 'PATCH', 'DELETE'].includes(part.text)) {
                methods.add(part.text as Method)
              }
              ts.forEachChild(part, literals)
            }
            literals(methodProperty.initializer)
          } else {
            methods.add('GET')
          }
        } else {
          methods.add('GET')
        }
      }
    }
    ts.forEachChild(candidate, collect)
  }
  collect(node)
  return methods
}

function collectAccessOperations(
  node: ts.Node,
  file: string,
  found: Set<string>,
  locals: Map<string, ts.Node> = new Map(),
): void {
  const expanded = new Set<ts.Node>([node])
  const visit = (part: ts.Node): void => {
    if (ts.isCallExpression(part) && ts.isIdentifier(part.expression)) {
      const declaredMethod = apiMethods.get(part.expression.text)
      const isFetch = part.expression.text === 'fetch'
      if ((declaredMethod || isFetch) && part.arguments[0]) {
        const pathNames = pathsIn(part.arguments[0])
        if (declaredMethod) {
          assert.ok(pathNames.size > 0, `${file}: ${part.expression.text} must address a declared paths.* entry`)
          for (const pathName of pathNames) found.add(operationFor(declaredMethod, pathName))
        } else if (pathNames.size > 0) {
          // Streaming/auth fetches deliberately bypass the JSON client, but
          // still declare their operation through paths.*. Derive literal or
          // conditional methods from the options; absent means GET.
          const methods = methodsIn(part)
          for (const method of methods) {
            for (const pathName of pathNames) found.add(operationFor(method, pathName))
          }
        }
      }
      const local = locals.get(part.expression.text)
      if (local && !expanded.has(local)) {
        // When a wrapper passes paths.foo into a private helper whose body owns
        // the HTTP method (authFlow is the earned example), combine those two
        // facts before following the helper body itself.
        const delegatedPaths = pathsIn(part)
        if (delegatedPaths.size > 0) {
          for (const method of methodsIn(local)) {
            for (const pathName of delegatedPaths) found.add(operationFor(method, pathName))
          }
        }
        expanded.add(local)
        visit(local)
      }
    }
    ts.forEachChild(part, visit)
  }
  visit(node)
}

/** The actual shipped UI operation set. An operation only enters by appearing
 * as a `paths.*` argument to the one API funnel; comments, unused path entries,
 * and server-only routes cannot satisfy the scan. */
function uiOperations(): Set<string> {
  const found = new Set<string>()
  const used = usedApiExports()
  const deadProductWrappers: string[] = []
  for (const file of reachableFiles) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    const normalized = file.replaceAll('\\', '/')
    if (normalized.endsWith('/src/api/hooks.ts') || normalized.endsWith('/src/api/commands.ts')) {
      const locals = accessDeclarations(source, false)
      for (const [name, declaration] of accessDeclarations(source, true)) {
        const target = new Set<string>()
        collectAccessOperations(declaration, file, target, locals)
        if (used.has(name)) {
          for (const operation of target) found.add(operation)
        } else {
          for (const operation of target) {
            const op = catalog.find((candidate) => routeKey(candidate.method, candidate.pattern) === operation)
            if (op?.access.kind === 'product') deadProductWrappers.push(`${name} → ${operation}`)
          }
        }
      }
    } else {
      collectAccessOperations(source, file, found)
    }
  }
  const liveCapabilities = new Set(
    [...found]
      .map((operation) => catalog.find((candidate) => routeKey(candidate.method, candidate.pattern) === operation))
      .filter((op) => op?.access.kind === 'product')
      .map((op) => op!.capability!),
  )
  assert.deepEqual(
    deadProductWrappers.filter((entry) => {
      const operation = entry.slice(entry.indexOf(' → ') + 3)
      const op = catalog.find((candidate) => routeKey(candidate.method, candidate.pattern) === operation)
      return op?.access.kind === 'product' && !liveCapabilities.has(op.capability!)
    }).sort(),
    [],
    'an unused API wrapper is not a UI capability — remove it or wire a real consumer',
  )
  assert.ok(found.size > 80, `UI operation discovery must enumerate the real surface; found only ${found.size}`)
  return found
}

const delta = (left: Set<string>, right: Set<string>) => [...left].filter((key) => !right.has(key)).sort()

test('authenticated UI, in-session MCP, and remote MCP expose the same product capabilities in both directions', () => {
  const byOperation = new Map(catalog.map((op) => [routeKey(op.method, op.pattern), op]))
  const product = catalog.filter((op) => op.access.kind === 'product')
  const productOperations = new Set(product.map((op) => routeKey(op.method, op.pattern)))
  const productCapabilities = new Set(product.map((op) => op.capability!))

  const uiCalls = uiOperations()
  const uiCapabilities = new Set<string>()
  for (const op of catalog.filter((candidate) => candidate.access.kind === 'form' && candidate.access.ui === 'form')) {
    assert.ok(
      uiCalls.has(routeKey(op.method, op.pattern)),
      `${routeKey(op.method, op.pattern)} is declared as a UI form and must remain reachable from the shipped import graph`,
    )
  }
  for (const key of uiCalls) {
    const op = byOperation.get(key)
    assert.ok(op, `UI operation is a live route: ${key}`)
    if (op.access.kind === 'product') {
      uiCapabilities.add(op.capability!)
    } else {
      assert.equal(
        op.access.ui,
        'form',
        `${key} is used by the UI but is declared as a non-UI form; product capability cannot be hidden by reclassification`,
      )
    }
  }

  const remoteRoutes = mcpToolRoutes(router)
  const remoteOperations = new Set(remoteRoutes.map((op) => routeKey(op.method, op.pattern)))
  const remoteCapabilities = new Set(remoteRoutes.filter((op) => op.access.kind === 'product').map((op) => op.capability!))
  const sessionTools = [...deriveApiTools(catalog).byName.values()]
  const sessionToolOperations = new Set(sessionTools.map((op) => routeKey(op.method, op.pattern)))
  const sessionCapabilities = new Set([
    ...sessionTools.map((op) => op.capability!),
    ...product.filter((op) => op.access.session === 'intrinsic').map((op) => op.capability!),
  ])

  // The runtime projections themselves are total over the route-owned policy.
  assert.deepEqual(
    {
      remoteMcp: {
        missingTools: delta(
          new Set(catalog.filter((op) => op.access.kind === 'product' || op.access.remote === 'tool').map((op) => routeKey(op.method, op.pattern))),
          remoteOperations,
        ),
        extraTools: delta(
          remoteOperations,
          new Set(catalog.filter((op) => op.access.kind === 'product' || op.access.remote === 'tool').map((op) => routeKey(op.method, op.pattern))),
        ),
      },
      sessionMcp: {
        missingTools: delta(
          new Set(product.filter((op) => op.access.session !== 'intrinsic').map((op) => routeKey(op.method, op.pattern))),
          sessionToolOperations,
        ),
        extraTools: delta(sessionToolOperations, productOperations),
      },
    },
    {
      remoteMcp: { missingTools: [], extraTools: [] },
      sessionMcp: { missingTools: [], extraTools: [] },
    },
    'both MCP catalogs are generated from the route-owned access projection',
  )

  // Semantic capability identities are the cross-form symmetry boundary. A
  // by-id route may alias its list projection, and the in-session form may be
  // intrinsic, but no surface may gain or lose an ability.
  assert.deepEqual(
    {
      ui: { missing: delta(productCapabilities, uiCapabilities), extra: delta(uiCapabilities, productCapabilities) },
      remoteMcp: { missing: delta(productCapabilities, remoteCapabilities), extra: delta(remoteCapabilities, productCapabilities) },
      sessionMcp: { missing: delta(productCapabilities, sessionCapabilities), extra: delta(sessionCapabilities, productCapabilities) },
    },
    {
      ui: { missing: [], extra: [] },
      remoteMcp: { missing: [], extra: [] },
      sessionMcp: { missing: [], extra: [] },
    },
    'UI and both MCP forms must be a capability bijection',
  )
})

test('every non-default route realization explains itself at the route declaration', () => {
  for (const op of catalog) {
    if (op.access.kind === 'form' || op.access.session === 'intrinsic' || op.capability !== routeKey(op.method, op.pattern)) {
      assert.ok((op.access.reason?.length ?? 0) > 24, `${routeKey(op.method, op.pattern)} carries a substantive access reason`)
    }
    if (op.access.kind === 'form' && op.access.remote === 'tool') {
      assert.equal(op.access.ui, 'form', `${routeKey(op.method, op.pattern)} remote bootstrap also has a UI entry form`)
    }
    if (op.access.kind === 'product') assert.ok(op.capability, `${routeKey(op.method, op.pattern)} has a capability identity`)
  }
})
