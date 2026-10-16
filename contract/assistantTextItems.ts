/** Visible assistant prose grouped by provider message item. This is not a
 * reasoning transcript: opaque/signed reasoning never enters durable history. */
export interface AssistantTextItem {
  text: string
  phase?: 'commentary' | 'final_answer' | null
}

export const MAX_ASSISTANT_TEXT_ITEMS = 4096

/** Optional metadata must describe the exact visible prose, never replace it.
 * History may allow one extra host-authored receipt item beyond the disk cap. */
export function isAssistantTextItems(value: unknown, content: unknown, maxItems = MAX_ASSISTANT_TEXT_ITEMS): value is AssistantTextItem[] {
  if (typeof content !== 'string' || !Array.isArray(value) || !value.length || value.length > maxItems) return false
  let offset = 0
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => key !== 'text' && key !== 'phase') || typeof item.text !== 'string' ||
        (Object.hasOwn(item, 'phase') && item.phase !== null && item.phase !== 'commentary' && item.phase !== 'final_answer') ||
        !content.startsWith(item.text, offset)) return false
    offset += item.text.length
  }
  return offset === content.length
}
