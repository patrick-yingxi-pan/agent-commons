import { motion } from 'framer-motion'
import type { Message as MessageT } from '../types'
import { renderRich } from '../lib/rich'
import { ClaudeMark } from './ClaudeMark'
import { RelationActionCard } from './RelationActionCard'
import { ToolActivityCard } from './ToolActivityCard'

export function MessageRow({ message }: { message: MessageT }) {
  const isUser = message.role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="px-4 py-3"
    >
      <div className="mx-auto flex w-full max-w-3xl gap-3">
        <div className="mt-0.5 shrink-0">
          {isUser ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-userbubble text-xs font-semibold text-ink-soft">
              P
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-tint">
              <ClaudeMark size={16} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-xs font-semibold text-ink-soft">
            {isUser ? 'You' : 'Claude'}
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {renderRich(message.content)}
          </div>
          {message.toolActivities && message.toolActivities.length > 0 && (
            <ToolActivityCard activities={message.toolActivities} />
          )}
          {message.relationActions && message.relationActions.length > 0 && (
            <RelationActionCard ops={message.relationActions} />
          )}
        </div>
      </div>
    </motion.div>
  )
}

export function TypingRow() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="px-4 py-3"
    >
      <div className="mx-auto flex w-full max-w-3xl gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint">
          <ClaudeMark size={16} />
        </div>
        <div className="flex items-center gap-1 pt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink-faint"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
