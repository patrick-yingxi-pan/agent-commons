import { lazy, type ComponentProps } from 'react'
import type { ConversationSearch } from './ConversationSearch.tsx'
import { DeferredConversationFeature } from './DeferredConversationFeature.tsx'

const Search = lazy(() => import('./ConversationSearch.tsx').then((module) => ({ default: module.ConversationSearch })))
type Props = ComponentProps<typeof ConversationSearch>

/** Keep the transcript and its opener usable until the optional dialog is ready. */
export function DeferredConversationSearch(props: Props) {
  return <DeferredConversationFeature feature="search" onClose={props.onClose}><Search {...props} /></DeferredConversationFeature>
}
