import { parentPort, workerData } from 'node:worker_threads'
import Ajv2020 from 'ajv/dist/2020.js'
import fastUri from 'fast-uri'
import traverse from 'json-schema-traverse'

const DIALECT = 'https://json-schema.org/draft/2020-12/schema'
const SUPPORTED_VOCABULARIES = new Set([
  'https://json-schema.org/draft/2020-12/vocab/core',
  'https://json-schema.org/draft/2020-12/vocab/applicator',
  'https://json-schema.org/draft/2020-12/vocab/unevaluated',
  'https://json-schema.org/draft/2020-12/vocab/validation',
  'https://json-schema.org/draft/2020-12/vocab/meta-data',
  'https://json-schema.org/draft/2020-12/vocab/format-annotation',
  'https://json-schema.org/draft/2020-12/vocab/content',
])
const SCHEMA_VALUES = new Set([
  'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'items',
  'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties',
])
const SCHEMA_ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_MAPS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties'])
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const INVALID_POINTER = Symbol('invalid-pointer')
const ROOT_BASE = 'https://agent-commons.invalid/.well-known/mcp-schema-root'
// Match the pinned validator's JSON Pointer scope rules, including pointers
// through annotation data which its all-keys locator traversal does not visit.
const POINTER_SCOPE_CONTAINERS = new Set(['properties', 'patternProperties', 'enum', 'dependencies', 'definitions'])

const splitUri = (uri) => {
  const marker = uri.indexOf('#')
  return marker < 0 ? { document: uri, fragment: '' } : {
    document: uri.slice(0, marker), fragment: uri.slice(marker + 1),
  }
}

const resolvedUri = (base, reference) => {
  if (typeof reference !== 'string') return INVALID_POINTER
  try { return fastUri.resolve(base, reference) } catch { return INVALID_POINTER }
}

const localPointerTarget = (resources, anchors, base, reference) => {
  if (typeof reference !== 'string') return undefined
  const resolved = resolvedUri(base, reference)
  if (resolved === INVALID_POINTER) return INVALID_POINTER
  const anchored = anchors.get(resolved)
  if (anchored) return anchored
  const { document, fragment } = splitUri(resolved)
  const resource = resources.get(document)
  if (!resource) return undefined
  if (!fragment) return { target: resource.root, context: resource }
  if (!fragment.startsWith('/')) return undefined // named anchors are found in schema positions below
  let target = resource.root
  let current = resource
  for (const token of fragment.slice(1).split('/')) {
    let key
    try { key = decodeURIComponent(token).replaceAll('~1', '/').replaceAll('~0', '~') }
    catch { return INVALID_POINTER }
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return INVALID_POINTER
    target = target[key]
    if (record(target) && typeof target.$id === 'string' && !POINTER_SCOPE_CONTAINERS.has(key)) {
      const id = resolvedUri(current.base, target.$id)
      if (id === INVALID_POINTER) return INVALID_POINTER
      const location = splitUri(id)
      if (location.fragment) return INVALID_POINTER
      // Pointer traversal changes the evaluation base, not the registry of
      // embedded resources (for example a $id inside default is not registered).
      current = { base: location.document, root: target }
    }
  }
  return { target, context: current }
}

const schemaContext = (schema, context, resources) => {
  if (!Object.hasOwn(schema, '$id')) return context
  const id = resolvedUri(context.base, schema.$id)
  if (id === INVALID_POINTER) return INVALID_POINTER
  const location = splitUri(id)
  if (location.fragment) return INVALID_POINTER
  const existing = resources.get(location.document)
  if (existing && existing.root !== schema) return INVALID_POINTER
  const current = { base: location.document, root: schema }
  resources.set(location.document, current)
  return current
}

/** Register every standard schema resource before following references. Ajv
 * resolves forward references to embedded `$id` resources, so inspecting refs
 * in a single traversal would miss a later resource's annotation-pointer target. */
const collectResources = (schema, context, resources, seen = new Set()) => {
  if (typeof schema === 'boolean') return undefined
  if (!record(schema) || seen.has(schema)) return undefined
  seen.add(schema)
  const current = schemaContext(schema, context, resources)
  if (current === INVALID_POINTER) return 'invalid_schema'
  for (const [keyword, nested] of Object.entries(schema)) {
    if (SCHEMA_VALUES.has(keyword)) {
      const result = collectResources(nested, current, resources, seen)
      if (result) return result
    } else if (SCHEMA_ARRAYS.has(keyword) && Array.isArray(nested)) {
      for (const candidate of nested) {
        const result = collectResources(candidate, current, resources, seen)
        if (result) return result
      }
    } else if (SCHEMA_MAPS.has(keyword) && record(nested)) {
      for (const candidate of Object.values(nested)) {
        const result = collectResources(candidate, current, resources, seen)
        if (result) return result
      }
    } else if (keyword === 'dependencies' && record(nested)) {
      for (const candidate of Object.values(nested)) {
        if (Array.isArray(candidate)) continue
        const result = collectResources(candidate, current, resources, seen)
        if (result) return result
      }
    }
  }
  return undefined
}

/** Ajv registers `$id`, `$anchor`, and `$dynamicAnchor` across its own all-keys
 * locator traversal, including objects below unknown keywords. Mirror only that
 * target index: an annotation remains inert unless an actual ref selects it. */
const collectAjvLocators = (schema, context, resources, anchors) => {
  if (typeof schema === 'boolean') return undefined
  let refusal
  const contexts = new Map()
  traverse(schema, { allKeys: true }, (candidate, pointer, _root, parentPointer) => {
    if (refusal) return
    const parent = parentPointer === undefined ? context : contexts.get(parentPointer)
    if (!parent) { refusal = 'invalid_schema'; return }
    // Ajv's locator pass treats only string `$id`/anchor values as locators.
    // Other values under an unreferenced annotation stay ordinary inert data;
    // standard schema positions are validated by collect/inspect/Ajv itself.
    const current = typeof candidate.$id === 'string'
      ? schemaContext(candidate, parent, resources)
      : parent
    if (current === INVALID_POINTER) { refusal = 'invalid_schema'; return }
    contexts.set(pointer, current)
    for (const keyword of ['$anchor', '$dynamicAnchor']) {
      const anchor = candidate[keyword]
      if (anchor === undefined) continue
      if (typeof anchor !== 'string') continue
      if (!/^[a-z_][-a-z0-9._]*$/i.test(anchor)) {
        refusal = 'invalid_schema'; return
      }
      const location = resolvedUri(current.base, `#${anchor}`)
      if (location === INVALID_POINTER) { refusal = 'invalid_schema'; return }
      const existing = anchors.get(location)
      if (existing && existing.target !== candidate) { refusal = 'invalid_schema'; return }
      anchors.set(location, { target: candidate, context: current })
    }
  })
  return refusal
}

/** Walk only positions which 2020-12 defines as schemas. Unknown keywords are
 * annotations here: their payload cannot smuggle an Ajv extension into use. */
const inspectSchema = (schema, context, resources, anchors, seen = new Map(), resolvedContext = false) => {
  if (typeof schema === 'boolean') return undefined
  if (!record(schema)) return 'invalid_schema'
  // Reference locators already include the target's own $id. Applying it a
  // second time would change relative bases; ordinary child traversal does not.
  const current = resolvedContext ? context : schemaContext(schema, context, resources)
  if (current === INVALID_POINTER) return 'invalid_schema'
  const visitedBases = seen.get(schema) ?? new Set()
  if (visitedBases.has(current.base)) return undefined
  visitedBases.add(current.base)
  seen.set(schema, visitedBases)
  if (Object.hasOwn(schema, '$schema')) {
    if (typeof schema.$schema !== 'string') return 'invalid_schema'
    if (schema.$schema !== DIALECT) return 'unsupported_dialect'
  }
  // Ajv gives OpenAPI's non-standard `nullable` keyword validation meaning.
  // Remove it only at actual schema positions from this worker-owned snapshot;
  // similarly named instance properties and annotation payloads remain intact.
  if (Object.hasOwn(schema, 'nullable')) delete schema.nullable
  if (Object.hasOwn(schema, '$async')) return 'invalid_schema'
  if (Object.hasOwn(schema, '$vocabulary')) {
    if (!record(schema.$vocabulary)) return 'invalid_schema'
    for (const [name, required] of Object.entries(schema.$vocabulary)) {
      if (typeof required !== 'boolean') return 'invalid_schema'
      if (required && !SUPPORTED_VOCABULARIES.has(name)) return 'invalid_schema'
    }
  }
  for (const keyword of ['$ref', '$dynamicRef', '$recursiveRef']) {
    const target = localPointerTarget(resources, anchors, current.base, schema[keyword])
    if (target === INVALID_POINTER) return 'invalid_schema'
    if (target !== undefined) {
      const result = inspectSchema(target.target, target.context, resources, anchors, seen, true)
      if (result) return result
    }
  }
  for (const [keyword, nested] of Object.entries(schema)) {
    if (SCHEMA_VALUES.has(keyword)) {
      const result = inspectSchema(nested, current, resources, anchors, seen)
      if (result) return result
    } else if (SCHEMA_ARRAYS.has(keyword) && Array.isArray(nested)) {
      for (const candidate of nested) {
        const result = inspectSchema(candidate, current, resources, anchors, seen)
        if (result) return result
      }
    } else if (SCHEMA_MAPS.has(keyword) && record(nested)) {
      for (const candidate of Object.values(nested)) {
        const result = inspectSchema(candidate, current, resources, anchors, seen)
        if (result) return result
      }
    } else if (keyword === 'dependencies' && record(nested)) {
      for (const candidate of Object.values(nested)) {
        if (Array.isArray(candidate)) continue
        const result = inspectSchema(candidate, current, resources, anchors, seen)
        if (result) return result
      }
    }
  }
  return undefined
}

const reply = (result) => parentPort?.postMessage(result)

try {
  const { schema, hasValue, value } = workerData
  const resources = new Map([[ROOT_BASE, { base: ROOT_BASE, root: schema }]])
  const anchors = new Map()
  const root = resources.get(ROOT_BASE)
  const refusal = collectResources(schema, root, resources) ??
    collectAjvLocators(schema, root, resources, anchors) ??
    inspectSchema(schema, root, resources, anchors)
  if (refusal) {
    reply({ ok: false, code: refusal })
  } else {
    const ajv = new Ajv2020({
      strict: false,
      allErrors: false,
      validateSchema: true,
      validateFormats: false,
      $data: false,
      $comment: false,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      ownProperties: true,
      logger: false,
      code: { source: false, optimize: 1 },
    })
    const validate = ajv.compile(schema)
    reply(validate.$async === true
      ? { ok: false, code: 'invalid_schema' }
      : !hasValue || validate(value) === true
      ? { ok: true }
      : { ok: false, code: 'invalid_value' })
  }
} catch {
  reply({ ok: false, code: 'invalid_schema' })
}
