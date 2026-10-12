import type { DispatchBinding } from './dispatchExecution.ts'
import { isClosedRecord } from './closedRecord.mjs'
import { parseProjectWorkMcpDraftSelection, type ProjectWorkMcpDraftSelection } from './projectWorkMcpDraft.ts'

/** Private provenance for a draft tied to one authored Project-work item.
 * These references are not authority to reserve, complete, or perform work. */
export interface ProjectWorkDraftSource {
  projectId: string
  itemId: string
  commissionId: string
  expectedRevision: number
}

/** The exact user-reviewed Project-work context and explicit one-off binding. */
export interface ProjectWorkDraftInput {
  projectWork: ProjectWorkDraftSource
  execution: DispatchBinding
  /** Exact reviewed local MCP selection; not execution permission. */
  mcpProposal?: ProjectWorkMcpDraftSelection
}

const MAX_ID_CHARS = 200
const SOURCE_KEYS = ['projectId', 'itemId', 'commissionId', 'expectedRevision'] as const
const BINDING_KEYS = ['agentId', 'providerId', 'modelId'] as const
const INPUT_KEYS = ['projectWork', 'execution'] as const
const OPTIONAL_INPUT_KEYS = ['mcpProposal'] as const

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Read only own data properties so even a hand-built/accessor object cannot
 * run caller code during boundary validation. */
function dataValues<T extends readonly string[]>(value: Record<string, unknown>, keys: T): Record<T[number], unknown> | undefined {
  const values: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
    values[key] = descriptor.value
  }
  return values as Record<T[number], unknown>
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS && !!value.trim()
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseSource(value: unknown): ProjectWorkDraftSource | undefined {
  if (!plainRecord(value) || !isClosedRecord(value, SOURCE_KEYS, 'all')) return undefined
  const fields = dataValues(value, SOURCE_KEYS)
  if (!fields || !boundedId(fields.projectId) || !boundedId(fields.itemId) ||
    !boundedId(fields.commissionId) || !validRevision(fields.expectedRevision)) return undefined
  return {
    projectId: fields.projectId,
    itemId: fields.itemId,
    commissionId: fields.commissionId,
    expectedRevision: fields.expectedRevision,
  }
}

/** Parse and detach the exact source identity/revision for a Project-work draft. */
export function parseProjectWorkDraftSource(value: unknown): ProjectWorkDraftSource | undefined {
  try {
    return parseSource(value)
  } catch {
    return undefined
  }
}

/** Parse and detach the exact Project-work draft context and Dispatch binding.
 * No title/detail, completion claim, reservation, or external authority is
 * accepted by this input shape. */
export function parseProjectWorkDraftInput(value: unknown): ProjectWorkDraftInput | undefined {
  try {
    const allowedInputKeys: readonly string[] = [...INPUT_KEYS, ...OPTIONAL_INPUT_KEYS]
    if (!plainRecord(value) || Reflect.ownKeys(value).some((key) => typeof key !== 'string' ||
        !allowedInputKeys.includes(key)) ||
        !INPUT_KEYS.every((key) => Object.hasOwn(value, key))) return undefined
    const fields = dataValues(value, [...INPUT_KEYS, ...(Object.hasOwn(value, 'mcpProposal') ? OPTIONAL_INPUT_KEYS : [])])
    if (!fields) return undefined
    const projectWork = parseSource(fields.projectWork)
    const executionValue = fields.execution
    if (!projectWork || !plainRecord(executionValue) || !isClosedRecord(executionValue, BINDING_KEYS, 'all')) return undefined
    const executionFields = dataValues(executionValue, BINDING_KEYS)
    if (!executionFields || !boundedId(executionFields.agentId) || !boundedId(executionFields.providerId) ||
      !boundedId(executionFields.modelId)) return undefined
    const mcpProposal = Object.hasOwn(fields, 'mcpProposal')
      ? parseProjectWorkMcpDraftSelection(fields.mcpProposal)
      : undefined
    if (Object.hasOwn(fields, 'mcpProposal') && !mcpProposal) return undefined
    return {
      projectWork,
      execution: {
        agentId: executionFields.agentId,
        providerId: executionFields.providerId,
        modelId: executionFields.modelId,
      },
      ...(mcpProposal ? { mcpProposal } : {}),
    }
  } catch {
    return undefined
  }
}
