# Claude · Unified Workspace — a UI/UX proposal

> A working prototype arguing that the Claude desktop app's three top-level
> tabs — **Chat**, **Cowork**, and **Code** — should collapse into **one
> conversation with an adaptive workspace**.

This repo is a clickable demo built to accompany a written proposal to
Anthropic. It is **not** affiliated with or endorsed by Anthropic; all visuals
are an independent concept and use mock data.

---

## The argument in one breath

Chat, Cowork, and Code are the *same primitive* — a threaded conversation with
Claude plus some context and tools — presented as three siloed tabs. That split
forces you to **choose a mode before you know where the work will go**, keeps
**separate histories and composers** you can't flow between, and makes three
**heavily-overlapping** surfaces feel redundant.

The prototype proposes the alternative: you just start talking, and **context
(a folder, a repo, a connector) attaches to the thread**. The panel on the right
**progressively reveals** the right tools — artifacts for a workspace, a code
editor / diff / terminal for a repo — all inside one conversation, one history.

See [`PROPOSAL.md`](PROPOSAL.md) for the full write-up.

## What the demo shows

Open it and press **Play the tour**. One conversation walks through three beats
without ever switching tabs:

1. **Chat** — an ordinary message thread. No mode chosen up front.
2. **→ Workspace** — the same thread grows a workspace; a panel slides in with a
   one-pager, a launch email, and a hero image. *(This is today's "Cowork".)*
3. **→ Repo** — it becomes a coding session: a branch, a real diff, a passing
   test run in the terminal. *(This is today's "Code".)*

The sidebar shows the payoff: **one unified history**, every item tagged with
small capability badges instead of being scattered across three tabs. Open
"Refactor auth middleware" (chat + repo) or "Vector databases, explained"
(chat only) to see the panel adapt per conversation.

## Run it

Requires Node 18+ (developed on Node 25).

```bash
npm install
npm run dev      # → http://127.0.0.1:5173
```

Other scripts:

```bash
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

## Stack

- **React + TypeScript + Vite**
- **Tailwind CSS v4** (theme tokens approximate Claude's light palette)
- **framer-motion** for panel transitions, **lucide-react** for icons
- No backend — the conversation is scripted/mock data on purpose, so the demo
  is deterministic and easy to review.

## Project layout

```
src/
  App.tsx                 # state machine: thread, guided tour, adaptive panel
  data/
    demo.ts               # the scripted chat → workspace → repo escalation
    conversations.ts      # the unified sidebar history + canned states
    contextOptions.ts     # options + sample payloads for the Add-context flows
    connectorDetails.ts   # connector / MCP sidebar content (mock)
  lib/
    connectors.tsx        # shared connector → icon mapping
    thumbs.ts             # deterministic photo gradient by id
    focus.ts              # which chip's sidebar is open
  components/
    Sidebar.tsx           # unified history with capability badges
    Composer.tsx          # the box + an under-box toolbar (Enter to send)
    AddContextButton.tsx  # one entry point: files/folders/repos/connectors/MCP
    PermissionModeControl.tsx # permission mode menu (Ask/Accept/Plan/Auto/Bypass)
    AudioInputControl.tsx # mic + microphone device menu
    ModelEffortControl.tsx# model picker + effort + orthogonal mode toggles
    UsageControl.tsx      # usage ring + context-window / rate-limit popup
    CaptionBar.tsx        # guided-tour narration + controls
    IntroOverlay.tsx      # the motivation (problems with today's three tabs)
    PanelShell.tsx        # shared sliding sidebar chrome (header + close)
    WorkspacePanel.tsx    # workspace ⇄ repo sidebar (morphs by mode)
    ConnectorPanel.tsx    # connector / MCP sidebar: status, access, tools
    AttachmentPanel.tsx   # file / photo sidebar: preview & edit
    panels/
      ArtifactPanel.tsx   # workspace view (Cowork)
      CodePanel.tsx       # repo view: files / diff / terminal (Code)
```

## Status

Private prototype. Intended to be made public and shared with Anthropic
alongside the written proposal once it's ready.
