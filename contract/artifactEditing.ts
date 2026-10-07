import { parseStructuredArtifactBody, type StructuredArtifactBody } from './artifactAuthoring.ts'
import { MAX_AUTHORED_DOCUMENT_CHARS, parseDocBlocks, type DocBlock } from './content.ts'

/** Editing carries existing identity; authoring deliberately cannot mint it. */
export interface DocumentEditBody {
  type: 'doc'
  title: string
  blocks: (DocBlock & { id: string })[]
}
export type EditableArtifactBody = StructuredArtifactBody | DocumentEditBody

/** Strict, lossless admission for complete editable bodies. */
export function parseEditableArtifactBody(value: unknown): EditableArtifactBody | undefined {
  const structured = parseStructuredArtifactBody(value)
  if (structured) return structured
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const input = value as Record<string, unknown>
  if (input.type !== 'doc' || !['type', 'title', 'blocks'].every(key => Object.hasOwn(input, key)) ||
    Object.keys(input).some(key => !['type', 'title', 'blocks'].includes(key)) ||
    typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240) return undefined
  const blocks = parseDocBlocks(input.blocks)
  if (!blocks?.length || !blocks.every((block): block is DocBlock & { id: string } => typeof block.id === 'string')) return undefined
  const characters = blocks.reduce((sum, block) => sum + ('h' in block ? block.h.length :
    'p' in block ? block.p.length : 'ul' in block ? block.ul.join('').length :
    'code' in block ? block.code.join('').length : block.email.to.length + block.email.subject.length), 0)
  if (characters > MAX_AUTHORED_DOCUMENT_CHARS) return undefined
  return { type: 'doc', title: input.title, blocks }
}

/** One complete, reviewed document/sheet/deck draft. Unlike legacy prose-block edits,
 * replacement never has an unconditional-write form. Body type cannot change. */
export interface StructuredArtifactContentPatch {
  content: EditableArtifactBody
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
  const content = parseEditableArtifactBody(input.content)
  return content ? { content, expectedRevision: input.expectedRevision as number } : undefined
}
