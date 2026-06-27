# Context compaction — UI reference

> **Status: design reference, not built.** Captures a UI pattern worth copying
> when we implement context compaction. Nothing here ships today. The locked-in
> decisions live in [`../AGENTS.md`](../AGENTS.md) → "Design decisions (locked in)".

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

## Where it plugs into this prototype

Compaction is the natural sequel to the **context-window gauge** already built in
[`../src/components/UsageControl.tsx`](../src/components/UsageControl.tsx): the
inner water-level disc fills as the open thread grows (`usage.context.pct`, hue
`waterColor()` going blue → gold → red past 80%). Compaction is what happens
*at* the ceiling — so the caption + determinate bar belong inline in the thread
(near the composer / as a transient message row), and the gauge's disc should
visibly **drop back** once compaction completes (the freed-space payoff the copy
promises).

If/when built, follow the project's seams: the trigger and the resulting
token-count change are **server-owned** (the backend is the client of the model;
the UI caches the snapshot — see `UsageControl` header comment and `GET
/v1/usage`), surfaced over the existing usage channel rather than computed client
-side. Ship it with tests like everything else.

## Open questions for later

- **Auto vs. confirmed.** Claude Code auto-compacts. Does our consent-first model
  (escalations, relation edits all ask first) want a confirm step, or is
  compaction lossless-enough to run unprompted like a standing schedule? Lean
  unprompted, but make the *result* inspectable (what got summarized).
- **What the user can recover.** After compaction, is the pre-compaction detail
  reachable (expand the summarized span)? The copy promises continuity; the UI
  should not silently drop things the user might need.
- **Where the indicator lives.** Inline transient row vs. a state on the usage
  gauge vs. both. The reference puts it inline; the gauge drop-back is our addition.
