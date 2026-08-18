# Context system

The repository's context is an indexed graph, not a stack of manuals. This
document defines the graph so a rule is easy to find, cheap to load, and hard to
separate from the code and evidence that make it true.

## Disclosure levels

1. **Boot map** — [`AGENTS.md`](../AGENTS.md) says what the repository is, how
   to run it, the top-level laws, and where deeper context lives.
2. **Layer index** — a layer `CLAUDE.md` names its modules and summarizes only
   the rules that cross module boundaries.
3. **Module context** — a module `CLAUDE.md` owns local rules and points to the
   implementation and colocated locks.
4. **Decision detail** — `DESIGN.md`, `SPEC.md`, and `docs/` explain rationale,
   history, alternatives, and audits. Load these only for the rule being changed.

An outer level may summarize an inner level but must not copy its full body.
Rules move inward to the narrowest directory that owns them; cross-layer laws
stay in the nearest common parent.

## Controlled categories and order

Every context rule uses one category, and rule indexes keep this order:

1. `product` — what the prototype is and is not.
2. `architecture` — ownership, boundaries, projections, and composition.
3. `experience` — interaction, visual, navigation, and accessibility laws.
4. `data-access` — contract meaning, identity, tenancy, authorization, and
   persistence.
5. `verification` — tests, locks, review, and evidence.
6. `operations` — running, deployment, fixtures, and maintenance.

The order moves from intent to structure to observable form to protected state
to evidence to operation. A file uses only the categories relevant to its scope.

## Rule record

Normative context is summarized in a `Rule index` table with these columns:

| Column | Meaning |
|---|---|
| ID | Stable, repository-unique rule identifier. |
| Category | One controlled category above. |
| Rule | Short imperative or invariant. |
| Implementation | Links to the code or contract that owns the behavior. |
| Locks | Links to tests that fail when the behavior regresses. |
| Relations | IDs of parent, prerequisite, symmetric, or refining rules. |

The prose below a table may explain a rule, but it may not introduce a new
normative rule without adding a row. Relations make dependencies explicit:
`refines X`, `requires X`, `symmetric-with X`, or `parent X`. A genuinely
top-level law uses `root`.

## What the structural lock proves

[`tests/context-structure.test.ts`](../tests/context-structure.test.ts) derives
the context file set and verifies:

- boot maps stay within their size budgets;
- every scoped context is reachable from the boot map;
- required sections and rule columns exist in logical order;
- categories are controlled and ordered, IDs are unique, and every relation
  resolves;
- implementation and lock cells contain resolving repository links;
- every top-level law is referenced by at least one scoped rule;
- detailed companions are linked but do not become always-loaded context.

[`tests/context-map.test.ts`](../tests/context-map.test.ts) independently locks
transitive reachability from the boot map, detailed-decision anchors, and
relative-link integrity.

[`tests/doc-paths.test.ts`](../tests/doc-paths.test.ts) provides the broader
prose-path guard. Behavioral tests remain colocated with their owner; the
context lock checks correlation, not the behavior a cited suite already proves.
