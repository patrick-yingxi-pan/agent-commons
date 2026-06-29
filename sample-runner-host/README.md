# sample-runner-host/

Stands in for a connected **runner's host** — one of the three real filesystem
sources the Add-context *Files / Photos / Folder* types are served from (see
[`contract/fs.ts`](../contract/fs.ts) and
[`docs/capability-broker-architecture.md`](../docs/capability-broker-architecture.md)).

In the real architecture the runner runs on the user's machine and reads its own
disk; here the in-process broker reads this committed directory on the runner's
behalf, so the demo is deterministic. The seeded co-located runner
(`server/data/runners.ts`) advertises `fs.read` / `fs.list` scoped to `~/projects`,
and `RUNNER_FS_ROOTS` maps that runner to this folder (override the co-located
runner's root with `CONTEXT_RUNNER_ROOT`).

Reached two ways, both real: **browsing** to attach goes through the broker
(`/api/v1/fs/*?source=runner:<id>`), and a post-attach **effect** read goes through
the mediated, journaled `POST /runners/:id/invoke` (`fs.read` / `fs.list`). A remote
web backend seeds no runner, so this source only appears once a runner connects.

Same layout convention as [`../sample-cloud`](../sample-cloud/README.md): loose
files → Files, top-level images → Photos, sub-folders → Folder.
