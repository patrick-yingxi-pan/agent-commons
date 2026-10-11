/** Narrow, inert wire shapes for the form-only MCP MRTR foundation. */

export type McpFormPrimitive = string | number | boolean

export interface McpFormChoice {
  const: string
  title: string
}

export type McpFormStringSchema = {
  type: 'string'
  title?: string
  description?: string
  default?: string
  minLength?: number
  maxLength?: number
  format?: 'email' | 'uri' | 'date' | 'date-time'
  enum?: string[]
  oneOf?: McpFormChoice[]
}

export type McpFormNumberSchema = {
  type: 'number' | 'integer'
  title?: string
  description?: string
  default?: number
  minimum?: number
  maximum?: number
}

export type McpFormBooleanSchema = {
  type: 'boolean'
  title?: string
  description?: string
  default?: boolean
}

export type McpFormArraySchema = {
  type: 'array'
  title?: string
  description?: string
  minItems?: number
  maxItems?: number
  default?: string[]
  items: { type: 'string'; enum: string[] } | { anyOf: McpFormChoice[] }
}

export type McpFormPropertySchema = McpFormStringSchema | McpFormNumberSchema | McpFormBooleanSchema | McpFormArraySchema

export interface McpFormSchema {
  type: 'object'
  title?: string
  description?: string
  properties: Record<string, McpFormPropertySchema>
  required?: string[]
}

export interface McpFormInputRequest {
  method: 'elicitation/create'
  params: {
    mode?: 'form'
    message: string
    requestedSchema: McpFormSchema
  }
}

export interface McpFormInputRequired {
  resultType: 'input_required'
  inputRequests: Record<string, McpFormInputRequest>
  /** Opaque MCP continuation state. Consumers must echo it verbatim. */
  requestState?: string
}

export type McpFormAcceptedResponse = { action: 'accept'; content: Record<string, McpFormPrimitive | string[]> }
export type McpFormDeclinedResponse = { action: 'decline' | 'cancel' }
export type McpFormInputResponse = McpFormAcceptedResponse | McpFormDeclinedResponse
export type McpFormInputResponses = Record<string, McpFormInputResponse>
