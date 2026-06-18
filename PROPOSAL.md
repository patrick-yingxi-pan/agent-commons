# Proposal: Unify Chat, Cowork, and Code into one adaptive conversation

**Author:** Patrick Pan · independent concept
**Status:** Draft for discussion · accompanied by a working prototype in this repo
**Disclaimer:** Not affiliated with or endorsed by Anthropic. All UI is a concept; data is mocked.

---

## 1. Summary

The Claude desktop app currently exposes three top-level destinations — **Chat**,
**Cowork**, and **Code** — as sibling tabs. This proposal argues they are three
presentations of a single primitive and should be unified into **one
conversation surface with an adaptive workspace**: you start a normal
conversation, *attach context* to it (a folder, a repository, a connector), and
the UI **progressively discloses** the right tools as the work demands them.

The prototype in this repo demonstrates the end state. The rest of this document
makes the case and sketches how a real migration could work.

## 2. The problem

Today, the first decision a user makes is **which tab to open** — i.e. which
*mode* the work belongs to — *before* they've started and often before they know
where it will end up. That up-front commitment produces three concrete costs.

### 2.1 You choose a mode before the work has a shape
A lot of real work doesn't announce itself as "a chat" vs. "a coding task" vs.
"an agentic project." It starts as a question and *becomes* something. Forcing
the classification up front is friction at the worst possible moment — the start,
when you know the least.

### 2.2 The tabs are silos with no flow between them
Each tab carries its own conversation history and its own composer. A discussion
that started in **Chat** can't gracefully *become* a **Code** task: you switch
tabs, start over, and re-establish the context you just built. The thread of
thought — and the actual context window — does not travel with you.

### 2.3 The capabilities overlap, so three tabs read as redundant
All three are "a conversation with Claude that can use tools." Chat is that with
no attached context. Cowork is that with a working directory and connectors.
Code is that with a repository and a terminal. The differences are **which
context is attached**, not **what kind of thing the surface is**. Presenting
near-identical surfaces as three destinations invites the question every new
user asks: *"wait, which one do I use?"*

> **Note on scope.** This proposal deliberately does not reproduce today's UI.
> Anyone can open the live app to compare. The point here is the *direction*, and
> the prototype shows where it leads.

## 3. The reframing: one primitive, three amounts of context

| Today's tab | What it really is |
|-------------|-------------------|
| **Chat**    | A conversation with **no attached context**. |
| **Cowork**  | A conversation with **a workspace** (files, artifacts, connectors). |
| **Code**    | A conversation with **a repository** (editor, diff, terminal). |

Once you see the tabs this way, the unification is obvious: **capability is an
attribute of a conversation, not a category of app.** A single conversation can
hold none, one, or all three at once.

## 4. The proposal

### 4.1 One conversation surface
Every interaction begins the same way: a single thread and a single composer.
There is no mode to pick. This is the default the prototype opens to.

### 4.2 Context attaches to the thread
Instead of choosing "Code," you **attach a repo** (or a folder, or a connector)
to the conversation. Attachment is what grants capability. In the prototype the
attached context is shown as **chips above the composer** (`▸ workspace/`,
`▸ feat/insights-dashboard`, `▸ GitHub`).

Because *everything* attachable — files, folders, repos, photos, connectors, MCP
servers — is just context, the prototype funnels them all through **one
consistent "Add context" entry point** on the composer. A single button opens a
type picker; each type then runs its own short workflow (recent folders, your
repositories, the connector list, the MCP registry, a file drop zone, a photo
grid). One affordance replaces today's scattering of per-type controls (a
paperclip for files, a separate `+`, and so on), and it doubles as the
discoverable answer to "what can I attach?"

### 4.3 The workspace panel is adaptive and progressive
A right-hand panel **morphs to fit the attached context** and is otherwise
absent:

- **No context** → no panel. It's just a chat.
- **Workspace attached** → an **artifacts** panel (documents, emails, images).
- **Repo attached** → a **code** panel (file tree, diff, terminal).
- **Files / photos attached** → a **preview & edit** panel, opened from the
  grouped thumbnail tiles on the composer (a photo grid with crop/annotate, an
  editable view for text files).

It can be collapsed to a rail at any time. Tools appear *because the work needs
them*, not because you navigated to them.

### 4.4 Escalation is fluid and in-place
The defining move: a plain chat can **level up into a workspace, then into a
repo, in the same thread**, carrying all prior context. The prototype's guided
tour is exactly this — strategy chat → drafts a one-pager/email (workspace) →
ships a feature flag and route (repo) — with no tab switch and nothing
re-explained.

### 4.5 One history, one search
Because there's only one kind of object, there's one list. The sidebar shows
every conversation tagged with small **capability badges**, filterable and
searchable in one place — instead of three histories you switch between.

## 5. How it maps to the prototype

| Proposal idea | Where to see it |
|---------------|-----------------|
| No mode chosen up front | The app opens to a single empty thread + composer. |
| Context as attachment | The **Add context** button — one entry point for files, folders, repos, photos, connectors, and MCP servers — and the chips it produces above the composer. |
| Progressive disclosure | The right panel is absent in chat, appears for workspace/repo. |
| Attachments are previewable | Files & photos attach as grouped thumbnail tiles; click one to open the right-side preview / edit panel. |
| In-place escalation | **Play the tour** — one thread, three beats. |
| Adaptive panel | The panel morphs from artifacts → code at the repo step. |
| Unified history | The sidebar list with capability badges; open different items. |

## 6. Design principles (carry beyond this one screen)

1. **Don't make people classify work before they start it.** Let the surface
   take the shape the work turns out to need.
2. **Context is the noun; capability follows from it.** Attach a thing, get the
   tools for that thing.
3. **Progressive disclosure over permanent chrome.** Show the editor/terminal
   when there's a repo; hide it otherwise.
4. **One thread is the unit of memory.** Strategy, artifacts, and code that
   belong to the same effort live and are found together.
5. **Reversibility.** Any panel can collapse; attaching context is additive and
   undoable.

## 7. Migration & compatibility (sketch)

Unifying the surface does **not** require deleting the workflows people rely on:

- **Entry points still work.** "New code session" / "New Cowork project" can
  remain as shortcuts that simply start a conversation *with that context
  pre-attached* — same destination, just no longer a separate tab.
- **Power users keep density.** The panel can default to expanded (and remember
  per-conversation) so repo-heavy users see editor + terminal immediately.
- **Incremental rollout.** The unified surface can ship behind a flag, opening
  as the default for new conversations while existing tabs remain reachable, then
  retire the tabs once parity is proven.

## 8. Risks & open questions

- **Discoverability of capabilities.** If there are no tabs, how do users learn
  they *can* attach a repo? (Prototype's answer: an always-present "Add context"
  affordance on the composer; this needs real testing.)
- **Panel real estate.** On small windows, chat + a code panel is tight; the
  collapse-to-rail behavior is a start but needs responsive rules.
- **Permissions & safety.** Escalating a chat into a repo session crosses a
  capability boundary (file writes, command execution). The attach step is the
  natural place for an explicit consent moment — worth designing carefully.
- **Naming.** "Workspace" vs. "Cowork", "Repo" vs. "Code" — terminology should
  be decided with the broader product language.
- **Backend reality.** Whether Chat/Cowork/Code share enough infrastructure to
  unify cleanly is an open question this concept can't answer from the outside.

## 9. What the prototype is and isn't

**Is:** a faithful, clickable illustration of the proposed interaction model and
visual direction, with a scripted end-to-end escalation and a unified history.

**Isn't:** a real client. There's no model, no file system, no execution; the
conversation content and panel data are mocked so the demo is deterministic and
reviewable. The goal is to make the *idea* tangible enough to react to.

---

*Feedback welcome. The intent is to share this with Anthropic as a constructive
proposal once the prototype and write-up are polished.*
