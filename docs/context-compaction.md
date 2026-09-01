# Context compaction

> **Status: built.** The selected provider now creates the continuation brief,
> originals remain in a bounded inspectable archive, and both generation and
> commit fail closed. The locked contract lives in MODEL-32 and the relevant
> directory-scoped `CLAUDE.md` files ([`../AGENTS.md`](../AGENTS.md) maps them).

## The reference artifact

Claude Code's terminal client shows this while it auto-compacts a long
conversation (captured 2026-06-27):

```
  ⠿   Compacting our conversation so we can keep chatting…
  ▰▰▰▰▰▰▰▰▰▰▰▰▰▱  94%
```

- A small **dotted/dashed ring spinner** in the brand terracotta (the "thinking"
  affordance, not a determinate arc).
- A **first-person-plural, reassuring caption** — *"Compacting **our**
  conversation so **we** can keep chatting…"*. It frames compaction as *enabling
  continued conversation*, not as a limit being hit or context being lost. No
  jargon ("summarizing", "truncating context window"); no alarm.
- A **determinate progress bar** (dark fill on a light track) with an explicit
  **percent**. The work has a known end, so the bar is determinate even though the
  spinner is indeterminate — the two read as "working" + "this far along".

## Why it's worth copying

- **Warm, conversational copy over mechanical status.** "so we can keep chatting"
  tells the user *why* this is happening and that nothing breaks — turning a
  scary-sounding operation (the model is about to forget things) into a routine,
  trustworthy one.
- **Determinate where it can be.** A percent + filled bar removes the "is it
  stuck?" anxiety of a bare spinner. Reserve the spinner for the genuinely
  unknown-duration part.
- **No blame, no limits language.** It never says "you've run out of context" —
  the design treats hitting the window as normal housekeeping, not user error.

## Shipped behavior

Compaction is the natural sequel to the **context-window gauge** in
[`../src/components/UsageControl.tsx`](../src/components/UsageControl.tsx): the
inner water-level disc fills as the open thread grows (`usage.context.pct`, hue
`waterColor()` going blue → gold → red past 80%). Compaction is what happens
through one explicit between-turn action today. The shipped transaction is:

1. The server freezes the active transcript and existing archive. The same gate
   excludes a live reply or another compaction on that conversation.
2. The selected endpoint or Session provider receives every compactable source
   byte through bounded hierarchical model calls. Its system framing preserves
   decisions, constraints, identifiers, uncertainty, and open work; it declares
   no tools. Summary token use is metered to the same tenant plan.
3. Only a non-empty model result whose frozen transcript still matches may commit.
   Provider failure, empty output, an overlarge reduction, or a concurrent
   transcript change archives nothing and leaves an explicit Retry.
4. The model-authored brief plus the latest four turns becomes active context.
   Endpoint and Session-provider turns both receive that active history on later
   generation. The originals remain durable in `Session.compactedMessages`.
5. The thread renders one **Conversation summary** disclosure. It shows the brief
   and pages the archive 40 messages at a time through the tenant-walled
   `/sessions/:id/compacted-messages` door. The gauge drops with active context.

The transient UI keeps the warm reference caption and an honest indeterminate
spinner. It does **not** draw a fictional percentage: the provider protocols do
not expose stable reduction progress. A determinate bar becomes valid only when
the backend can publish real completed-part / total-part progress.

## Deliberate follow-on

Auto-triggering near the actual selected model window remains a separate product
decision. Manual compaction is lossless and inspectable, but automatic model spend
and interruption policy should be chosen from lived usage rather than inferred.
