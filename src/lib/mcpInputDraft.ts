/** Inert form values only: remote defaults are hints, never silent answers. */
import type { McpFormInputResponses, McpFormInputResponse, McpFormPrimitive, McpFormPropertySchema } from '../../contract/mcpElicitation.ts'
import type { McpInputReview } from '../../contract/mcpInput.ts'

export type McpInputFieldDraft = string | string[]
export type McpInputFormDraft = { action: McpFormInputResponse['action']; fields: Record<string, McpInputFieldDraft> }
export type McpInputDraft = Record<string, McpInputFormDraft>

export function emptyMcpInputDraft(review: McpInputReview): McpInputDraft {
  return Object.fromEntries(Object.keys(review.inputRequests).map((id) => [id, { action: 'accept', fields: {} }]))
}

export function mcpInputChoices(schema: McpFormPropertySchema): { value: string; label: string }[] | undefined {
  if (schema.type === 'string') return schema.oneOf?.map((choice) => ({ value: choice.const, label: choice.title })) ??
    schema.enum?.map((value) => ({ value, label: value }))
  if (schema.type === 'array') return 'anyOf' in schema.items
    ? schema.items.anyOf.map((choice) => ({ value: choice.const, label: choice.title }))
    : schema.items.enum.map((value) => ({ value, label: value }))
  return undefined
}

export function compileMcpInputDraft(review: McpInputReview, draft: McpInputDraft): McpFormInputResponses {
  return Object.fromEntries(Object.entries(review.inputRequests).map(([id, request]) => {
    const form = draft[id]
    if (!form) throw new Error('Review each requested form before continuing.')
    if (form.action !== 'accept') return [id, { action: form.action }]
    const required = new Set(request.params.requestedSchema.required ?? [])
    const values: [string, McpFormPrimitive | string[]][] = []
    for (const [key, schema] of Object.entries(request.params.requestedSchema.properties)) {
      const raw = Object.hasOwn(form.fields, key) ? form.fields[key] : undefined
      const label = schema.title ?? key
      if (raw === undefined || (raw === '' && (schema.type !== 'string' || schema.format))) {
        if (required.has(key)) throw new Error(`Enter a value for ${label}.`)
        continue
      }
      if (schema.type === 'array') {
        if (!Array.isArray(raw) || raw.length < (schema.minItems ?? 0) || raw.length > (schema.maxItems ?? Infinity)) {
          throw new Error(`Check the number of choices for ${label}.`)
        }
        const choices = mcpInputChoices(schema)!
        if (new Set(raw).size !== raw.length || raw.some((value) => !choices.some((choice) => choice.value === value))) {
          throw new Error(`Choose only the listed values for ${label}.`)
        }
        values.push([key, [...raw]])
      } else if (typeof raw !== 'string') throw new Error(`Check the value for ${label}.`)
      else if (schema.type === 'boolean') {
        if (raw !== 'true' && raw !== 'false') throw new Error(`Choose Yes or No for ${label}.`)
        values.push([key, raw === 'true'])
      } else if (schema.type === 'number' || schema.type === 'integer') {
        const value = Number(raw)
        if (!raw.trim() || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) ||
            value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`Enter a valid ${schema.type} for ${label}.`)
        values.push([key, value])
      } else if (schema.type === 'string') {
        const length = [...raw].length
        const choices = mcpInputChoices(schema)
        if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? 4096) ||
            (choices && !choices.some((choice) => choice.value === raw))) throw new Error(`Check the value for ${label}.`)
        values.push([key, raw])
      }
    }
    return [id, { action: 'accept', content: Object.fromEntries(values) }]
  }))
}
