import { MAX_ARTIFACT_EXCERPT_CHARS, type ArtifactContent, type DocBlock } from './content.ts'

function blockPreview(block: DocBlock): string {
  if ('p' in block) return block.p
  if ('h' in block) return block.h
  if ('ul' in block) return block.ul.join(' · ')
  if ('code' in block) return block.code.join(' ')
  return `${block.email.subject} · ${block.email.to}`
}

/** A bounded preview of the exact current body, never an independently authored
 * synopsis. Use only when the materializer recorded body-derived provenance. */
export function artifactBodyExcerpt(body: ArtifactContent): string | undefined {
  let text: string
  switch (body.type) {
    case 'doc':
      text = body.blocks.map(blockPreview).find((text) => text.trim()) ?? ''
      break
    case 'sheet':
      text = `${body.rows.length} rows · ${body.columns.join(' · ')}`
      break
    case 'slides':
      text = `${body.slides.length} slides · ${body.slides[0]?.title ?? ''}`
      break
    default:
      return undefined
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ARTIFACT_EXCERPT_CHARS).trim()
}
