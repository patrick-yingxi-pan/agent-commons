import type { Discussion } from './social.ts'
import { discussionTitle } from './social.ts'
import { isServedCaptureTime, isSnapshotId } from './servedSnapshotIdentity.ts'

export const DISCUSSION_SNAPSHOT_MAX_BYTES = 65_536
const MAX_DISCUSSION_ID_CHARS = 200
const MAX_DISCUSSION_POSTS = 200
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u
const TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
const CONTEXT_PREFIX = 'discussion::'

export interface DiscussionSnapshot {
  version: 1
  snapshotId: string
  capturedAt: string
  discussionId: string
  title: string
  postCount: number
  text: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
}

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff || index + 1 >= value.length) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function validDiscussionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_DISCUSSION_ID_CHARS &&
    !CONTROLS.test(value) && hasWellFormedUnicode(value)
}

function validSnapshotText(value: unknown): value is string {
  return typeof value === 'string' && hasWellFormedUnicode(value) && !TEXT_CONTROLS.test(value) &&
    new TextEncoder().encode(value).byteLength <= DISCUSSION_SNAPSHOT_MAX_BYTES
}

function validPostTime(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false
  try { return isServedCaptureTime(new Date(value).toISOString()) }
  catch { return false }
}

/** Encode a discussion into a context id outside the ids used by other nouns. */
export function discussionContextId(discussionId: string): string {
  return `${CONTEXT_PREFIX}${encodeURIComponent(discussionId)}`
}

/** Decode only canonical ids produced by discussionContextId. */
export function discussionIdFromContextId(id: string): string | null {
  if (typeof id !== 'string' || !id.startsWith(CONTEXT_PREFIX)) return null
  try {
    const decoded = decodeURIComponent(id.slice(CONTEXT_PREFIX.length))
    return validDiscussionId(decoded) && discussionContextId(decoded) === id ? decoded : null
  } catch {
    return null
  }
}

const SNAPSHOT_FIELDS = ['version', 'snapshotId', 'capturedAt', 'discussionId', 'title', 'postCount', 'text'] as const

/** A detached whole transcript. The exact own-key set prevents callers from
 * smuggling tenant, report, reaction, read-cursor, or authority fields. */
export function isDiscussionSnapshot(value: unknown): value is DiscussionSnapshot {
  if (!record(value) || !exactFields(value, SNAPSHOT_FIELDS)) return false
  return value.version === 1 && isSnapshotId(value.snapshotId) && isServedCaptureTime(value.capturedAt) &&
    validDiscussionId(value.discussionId) && typeof value.title === 'string' && value.title.length > 0 &&
    value.title.length <= 160 && hasWellFormedUnicode(value.title) && !TEXT_CONTROLS.test(value.title) &&
    Number.isSafeInteger(value.postCount) && (value.postCount as number) >= 1 &&
    (value.postCount as number) <= MAX_DISCUSSION_POSTS && validSnapshotText(value.text)
}

type SnapshotPost = Pick<Discussion['posts'][number], 'id' | 'author' | 'body' | 'at' | 'replyTo'>

function validPost(value: unknown): value is SnapshotPost {
  if (!record(value)) return false
  return validDiscussionId(value.id) && typeof value.author === 'string' && value.author.trim().length > 0 &&
    value.author.length <= 200 && !CONTROLS.test(value.author) && hasWellFormedUnicode(value.author) &&
    typeof value.body === 'string' && hasWellFormedUnicode(value.body) && !TEXT_CONTROLS.test(value.body) &&
    validPostTime(value.at) &&
    (value.replyTo === undefined || validDiscussionId(value.replyTo))
}

/** Build the stable, complete transcript projection used when a discussion is
 * attached as context. It carries display authors, UTC post times, exact bodies,
 * and numeric parent positions only; it never serializes other post/thread data. */
export function buildDiscussionSnapshot(
  discussion: Pick<Discussion, 'id' | 'posts'>,
  snapshotId: string,
  capturedAt: string,
): DiscussionSnapshot | null {
  if (!discussion || !validDiscussionId(discussion.id) || !isSnapshotId(snapshotId) || !isServedCaptureTime(capturedAt) ||
      !Array.isArray(discussion.posts) || discussion.posts.length < 1 || discussion.posts.length > MAX_DISCUSSION_POSTS) return null

  const posts = discussion.posts
  if (!posts.every(validPost)) return null
  const postIndexes = new Map<string, number>()
  for (const [index, post] of posts.entries()) {
    if (postIndexes.has(post.id)) return null
    if (post.replyTo !== undefined) {
      const parentIndex = postIndexes.get(post.replyTo)
      if (parentIndex === undefined || parentIndex >= index) return null
    }
    postIndexes.set(post.id, index)
  }

  const title = discussionTitle(posts[0]?.body)
  if (!title || title.length > 160 || !hasWellFormedUnicode(title) || TEXT_CONTROLS.test(title)) return null

  const lines = posts.map((post, index) => {
    const parentIndex = post.replyTo === undefined ? undefined : postIndexes.get(post.replyTo)
    const reply = parentIndex === undefined ? '' : ` · reply to #${parentIndex + 1}`
    return `[${index + 1}] ${post.author} · ${new Date(post.at).toISOString()}${reply}\n${post.body}`
  })
  const text = `# ${title}\n\n${lines.join('\n\n')}`
  if (!validSnapshotText(text)) return null

  const snapshot: DiscussionSnapshot = {
    version: 1,
    snapshotId,
    capturedAt,
    discussionId: discussion.id,
    title,
    postCount: posts.length,
    text,
  }
  return isDiscussionSnapshot(snapshot) ? snapshot : null
}
