import type { Attachment } from '../types'
import { planAttachmentInput, workspaceInputAttachments } from '../../contract/attachmentInput'
import { DRAFT_ID } from '../data/liveSession'
import { useConversation } from '../controller/conversationStore'
import { isContextMutationHeld } from '../controller/conversationCore'
import { useContextWritable } from '../controller/useContextWritable'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { refreshServedAttachment } from '../controller/servedAttachmentRefresh'
import { useRelations } from '../controller/useRelations'
import { draft } from '../controller/draftController'
import { DiscussionContextPanel } from './DiscussionContextPanel'

/** One command adapter for the tiled pane and narrow/medium overlay. */
export function SessionDiscussionContextPanel({ sessionId, attachment, onClose }: {
  sessionId: string
  attachment: Attachment
  onClose?: () => void
}) {
  const writable = useContextWritable(sessionId)
  const { contextMutation, live } = useConversation(sessionId)
  const { removeContexts } = useSessionContextCommands(sessionId)
  const relations = useRelations()
  return <DiscussionContextPanel
    attachment={attachment}
    onClose={onClose}
    busy={isContextMutationHeld(contextMutation)}
    inputStatus={planAttachmentInput(workspaceInputAttachments(live)).find((item) => item.attachment.id === attachment.id)?.status}
    onRefresh={writable && sessionId !== DRAFT_ID ? (item) => { void refreshServedAttachment(sessionId, item) } : undefined}
    onRemove={writable ? (id) => {
      const focus = [{ kind: 'discussion' as const, id }]
      if (sessionId === DRAFT_ID) draft.removeContexts(focus)
      else void removeContexts(focus)
    } : undefined}
    onOpenSource={(id) => relations.navigate('discussions', id)}
  />
}
