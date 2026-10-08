import { lazy, type ComponentProps } from 'react'
import type { ConversationDownload } from './ConversationDownload.tsx'
import { DeferredConversationFeature } from './DeferredConversationFeature.tsx'

const Download = lazy(() => import('./ConversationDownload.tsx').then((module) => ({ default: module.ConversationDownload })))
type Props = ComponentProps<typeof ConversationDownload>

export function DeferredConversationDownload(props: Props) {
  return <DeferredConversationFeature feature="download" onClose={props.onClose}><Download {...props} /></DeferredConversationFeature>
}
