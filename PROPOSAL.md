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

Once you see the tabs this way, the unification follows: **capability is an
attribute of a conversation, not a category of app.** A single conversation can
hold none, one, or all three at once.

## 4. The proposal

### 4.1 One conversation surface
Every interaction begins the same way: a single thread and a single composer.
There is no mode to pick. This is the default the prototype opens to.

### 4.2 Context attaches to the thread
Instead of choosing "Code," you **attach a repo** (or a folder, or a connector)
to the conversation. Attachment is what grants capability. In the prototype the
attached context is shown as **chips above the composer** (`▸ insights-dashboard-launch/`,
`▸ feat/insights-dashboard`, `▸ GitHub`).

Because *everything* attachable — files, folders, repos, photos, connectors, MCP
servers — is just context, the prototype funnels them all through **one
consistent "Add context" entry point** on the composer. A single button opens a
type picker; each type then runs its own short workflow (recent folders, your
repositories, the connector list, the MCP registry, a file drop zone, a photo
grid). One affordance replaces today's scattering of per-type controls (a
paperclip for files, a separate `+`, and so on), and it doubles as the
discoverable answer to "what can I attach?"

### 4.3 The panel is adaptive, and every chip opens it
A right-hand panel shows the **focused context** and is otherwise absent. It
opens automatically as context attaches (and during the tour), and **every chip
above the composer is clickable** to open — or, if already open, close — that
context's view:

- **Workspace** → an **artifacts** panel (documents, emails, images).
- **Repo** → a **code** panel (file tree, diff, terminal).
- **Connector / MCP server** → a **detail** panel (status, what it can access,
  the resources or tools it exposes, and disconnect).
- **File / photo** → a **preview & edit** panel (an editable text view; a photo
  grid with crop / annotate / caption).

Only one panel shows at a time — the chips are the switcher, and the active
one is highlighted. A context *type* that holds more than one item (several
files, a couple of connectors) collapses into a single counted chip
(`▸ Files · 2`) whose popup lists the items, so the row stays compact; picking
one opens its view, and a trash button on each row removes it (after a
confirmation you can mute with "Don't ask again"). Tools appear *because the
work needs them*, not because you navigated to them.

### 4.4 Escalation is fluid and in-place
The defining move: a plain chat can **level up into a workspace, then into a
repo, in the same thread**, carrying all prior context. The prototype's guided
tour is exactly this — strategy chat → drafts a one-pager, launch email, and hero
image (workspace) → ships a feature flag and route (repo) — with no tab switch and nothing
re-explained.

### 4.5 One history, one search
Because there's only one kind of object, there's one list. The sidebar shows
every conversation as a **compact, one-line row**, searchable in one place —
instead of three histories you switch between. A conversation's capabilities
live *with the conversation*: open it and the **context chips above the
composer** (and the panel they open) show exactly what it carries.

### 4.6 Cross-cutting tools, not mode tabs
A conversation is the unit, but a few functions span all of them: starting a
**new task**, browsing **Projects**, finding any **Artifact**, managing
**Scheduled** runs, watching background **Dispatch** jobs, and **Customize**.
The sidebar keeps these as a small nav above the history — they are *tools*,
not modes. What it deliberately omits is the **Chat / Cowork / Code** tab
switcher: collapsing those three into one surface is the entire point, so
re-introducing them as tabs would undercut the argument. The modes survive
only as the **context attached to a conversation** — surfaced as the chips
above its composer — never as a gate you pass through first.

### 4.7 The relationship graph, edited with consent
The five things this surface models — a **session**, a **project**, an
**artifact**, a **context**, and a **schedule** — aren't islands. Every pair
relates, and the prototype already encodes all ten relationships:

| Pair | Relationship |
|------|--------------|
| Session ↔ Project | a session is **filed under** at most one project |
| Session ↔ Artifact | a session **produces** artifacts |
| Session ↔ Context | a session **attaches** context (a folder, repo, connector) |
| Session ↔ Schedule | a schedule **opens / delivers to** a session each run |
| Project ↔ Artifact | a project **collects** its artifacts |
| Project ↔ Context | a project **scopes** the context its work shares |
| Project ↔ Schedule | a project **owns** recurring schedules |
| Artifact ↔ Context | an artifact **derives from**, or is **promoted into**, a context |
| Artifact ↔ Schedule | a schedule **writes** an artifact on each run |
| Context ↔ Schedule | a schedule **uses** connectors and tools — the context it runs on |

Because the surface is one conversation, the natural place to *change* these
relationships is the conversation itself: **Claude proposes a relation edit and
you approve it inline**. "File this session under Insights dashboard," "save
this draft as an artifact," "have the triage schedule keep a digest" — each
arrives as a small confirmation card under Claude's message, and **nothing
changes until you confirm**. Confirm a card and the edit propagates to wherever
that relationship is drawn — the Projects list, the Artifacts gallery, a
schedule's delivery — because they all read one shared relation graph.

**Two kinds of consent.** Not every approval is the same shape:

- **Per-action** — a one-off edit (filing a session, re-filing an artifact,
  scoping a context) is confirmed *each time*, right when it's proposed.
- **Standing** — a **schedule** is the unit of *advance* approval. Approving a
  recurring workflow once pre-approves everything it does on **every run** — the
  session it opens, the artifact it overwrites, the connectors it uses — and it
  then executes those edits **unprompted** on its cadence. The card says so
  ("runs on every 2 hours — approved once, then unprompted"), and the schedule's
  page marks the effect *pre-approved*. This is the honest model for automation:
  you grant the recurring permission deliberately, in advance, not run by run.

## 5. How it maps to the prototype

| Proposal idea | Where to see it |
|---------------|-----------------|
| No mode chosen up front | The app opens to a single empty thread + composer. |
| Context as attachment | The **Add context** button — one entry point for files, folders, repos, photos, connectors, and MCP servers — and the chips it produces above the composer. |
| Progressive disclosure | The right panel is absent in chat; it opens as context attaches. |
| Every chip opens a panel | Click any context chip — workspace, repo, connector, MCP, file, or photo — to open its detail / preview / edit panel. |
| In-place escalation | **Play the tour** — one thread, three beats. |
| Adaptive panel | The panel morphs from artifacts → code at the repo step. |
| Unified history | The single sidebar list — one row per conversation; the open conversation's composer chips show what it carries. |
| Cross-cutting tools, not tabs | The sidebar nav — New task, Projects, Artifacts, Scheduled, Dispatch, Customize — and their section views; no Chat/Cowork/Code switcher. |
| Relations, edited with consent | The guided tour's **Organize** beat (and any "file this under…" message) — Claude proposes relation edits as inline cards; confirming one updates the Projects / Artifacts / Scheduled views. A standing card ("approve for all runs") shows the advance-approval model for schedules. |

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
6. **Claude proposes structure; you approve it.** The model can suggest how to
   file, link, and organize — but a relationship only changes on the user's
   confirmation. One-off edits confirm each time; a recurring schedule is
   approved once, in advance, and then runs unprompted.

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
  natural place for an explicit consent moment — worth designing carefully. The
  same applies when Claude proposes to *re-organize* things (move a session,
  promote an artifact into a project's context): each edit confirms inline. The
  subtle case is a **schedule**, which acts repeatedly — there the consent is an
  *advance* approval granted once and honored on every run, so the boundary is
  "do you trust this recurring workflow," asked up front, not re-asked each run.
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
