/** ARIA semantics for a glyph that conveys information rather than decoration. */
export function namedIconProps(label: string) {
  return { role: 'img' as const, 'aria-label': label }
}
