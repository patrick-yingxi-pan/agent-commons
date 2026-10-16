# Third-party filesystem MCP acceptance — 2026-10-15

## Scope and artifact

The owner approved official `@modelcontextprotocol/server-filesystem@1.0.0`,
locked dependencies in a disposable installation, generated files only, catalog
discovery and `list_directory` / `read_text_file`. No write tools, real files,
credentials or model calls were requested. A local program has normal OS access;
neither this review nor the package's allowed-directory setting is a sandbox.

The package was installed from npm with lifecycle scripts disabled. The lock
resolved MCP SDK 1.32.1; the dependency audit reported zero known vulnerabilities
at inspection time, not a security certification. Package entry/server sources
were inspected and stayed unchanged through acceptance.

The app was built from `9c9eb6f1` plus the narrow legacy notification correction
in `desktop/mcpStdioProtocol.mjs`. It is unsigned macOS arm64, Electron 44.7.2;
the external executable is Node 26.3.0. Native dialogs were actually operated;
no dialog override, peer replacement or disposable ASAR patch was used.

| Identity | SHA-256 |
| --- | --- |
| App ASAR | `e295f83f92747dfc7efe0c410b3c14d6b95455a9f95113da89d03b66378f1c49` |
| Corrected bridge source | `7b15f19bd7a850a95ab94a8bea5d64acb69933a78105f66ad2e9a76c7b457766` |
| Dependency lock | `d831b9bf703d264d1d0289d5b1aae0dd1572c39aa2354dc7d3311285bef1426f` |
| Package entry | `68e6aae96c907bf00089dd48b9f2fdd06113e6588d9915f19852cb468f9296d8` |
| Package server | `36b7f04058bc94f8e3986552aa17ebd56d01847235adf163f6f2b4c8861c6f81` |

## Demonstrated defect and lock

The initial native run cancelled correctly, then failed inspection after fresh
Allow. No tool calls ran. The package rejected modern discovery with `-32601`
and correctly negotiated legacy `2025-11-25`; the standalone production client
and supervisor admitted all 14 catalog entries. The desktop bridge, however,
applied its request allowlist to the dedicated initialized notification and
rejected it before `tools/list`.

The correction distinguishes that one notification from ordinary requests.
The new bridge subprocess regression fails against the original predicate,
then proves physical probe closure, fresh legacy initialization, discovery and
one separately approved call. A second lock rejects initialized-as-request,
arbitrary notifications and inspection tool calls before IPC. Deliberately
widening the request allowlist also failed that lock before restoration.
Production deadlines, budgets, source fences and tool consent remain unchanged.

## Accepted workflow

The successful original-app run used two generated people and one generated
directory containing only `sample.txt`:

1. Actual native Cancel left the portable connection unchanged and no launch
   vault file. Fresh exact Allow preceded encrypted launch custody and catalog
   inspection. The launch used absolute executable/entry/directory paths and an
   empty configured environment, without shell evaluation.
2. Two rendered Agent Requests used manually reviewed JSON arguments; no model
   drafted them. Each local-program acknowledgement began unchecked and Run
   stayed disabled until selected. Only the approved list/read tools ran.
3. Both literal text and structured results matched the exact generated data,
   including Unicode, form feed and NUL. The full saved execution matched SQLite.
   The generated file digest stayed unchanged.
4. After full quit, the generated source directory was moved aside. Full relaunch
   retained the signed-in owner and exact saved receipts without needing that
   source. Disconnect changed the saved status and encrypted grant file.
5. A supplemental read-only relaunch of the same disconnected profile waited
   for each account's exact page heading and outcome. Requester API responses
   and rendered pages omitted private execution; owner API responses and pages
   retained the exact original receipts. No new tool dispatch was requested.

Native consent, cancelled/connected states, owner receipts, source-absent
relaunch, disconnect and the loaded requester pages were visually reviewed.
This is one desktop window and two generated people, not a new viewport or
demo-roster matrix. The app ASAR, package files and lock stayed unchanged during
the accepted run and supplemental review.

## Evidence and limitations

Ignored local evidence is retained under
`.data/third-party-filesystem-mcp/run-p2gdwK/`: the original harness and lock,
exact result record, screenshots and `loaded-receipts-review.json`. The original
requester screenshots captured loading states and are not UI privacy evidence;
the `07-*-requester-loaded.png` captures supersede them. Two attempted full
repeats did not reach Cancel because an extra empty preview window was selected;
those are failed review attempts, not acceptance. A supplemental selector
initially matched both sidebar and main text; narrowing it to the main page
resolved the test defect before the successful read-only review.

The run did not instrument child counts or wire requests, so it does not claim
independent no-replay/process-count proof. Local bridge locks provide that
separate authored-peer evidence. It does not accept public-service OAuth,
effectful tools, other package versions, paid model workflows, signed/notarized
release, native Intel or a real update installation. Complete local and packaged
verifiers remain the landing gates; their results belong in the delivery handoff.
