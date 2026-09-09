import { parseStructuredArtifactBody, type StructuredArtifactBody } from './artifactAuthoring.ts'

/** One complete, reviewed sheet/deck draft. Unlike legacy prose-block edits,
 * replacement never has an unconditional-write form. Body type cannot change. */
export interface StructuredArtifactContentPatch {
  content: StructuredArtifactBody
}
export interface UpdateStructuredArtifactContentRequest extends StructuredArtifactContentPatch {
  expectedRevision: number
}

/** The strict replacement arm of PATCH /artifacts/:id/content. Shared shape
 * validation keeps API/MCP callers under the same bounds as the human editor. */
export function parseStructuredArtifactEdit(value: unknown): UpdateStructuredArtifactContentRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const input = value as Record<string, unknown>
  if (!Object.hasOwn(input, 'content') || !Object.hasOwn(input, 'expectedRevision') ||
    Object.keys(input).some((key) => key !== 'content' && key !== 'expectedRevision') ||
    !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) return undefined
  const content = parseStructuredArtifactBody(input.content)
  return content ? { content, expectedRevision: input.expectedRevision as number } : undefined
}
