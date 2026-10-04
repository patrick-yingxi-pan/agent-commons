# Desktop artifact-content projection — 2026-10-04 UTC

## Defect and repair

An actual native CSV artifact-import review on the unsigned arm64 build of
`2abc976d496c779f3ea5f106aabd27a681006ab4` found that a fresh clean desktop
profile returned `[]` from `/api/v1/artifacts` but the global demo body library
from `/api/v1/artifact-content`. Saving one Sheet added its body without removing
the fictional content. The UI's empty registry did not make that API safe for
model or MCP readers.

The repair projects bodies only through current artifact/session read authority.
Filename compatibility aliases must be unique across both registries and cannot
replace an exact ID, including one without a body. Renames and revocation remove
aliases with their authority; missing scope returns no content.

## Native regression evidence

- Source: the artifact-content repair working tree based on
  `057d5fe4e13b1eb7c8c20d03408ea40851e0e382`.
- Agent Commons 0.1.0, Electron 44.0.0, macOS 26.5.2 (25F84), arm64.
- Rebuilt app.asar SHA-256:
  `648c3e6494f783c7dc4cc66c108489fca684085bbec633ae47e9c8e1fcfa832e`.
- Ordinary executable launches used isolated temporary user-data directories,
  SQLite and real OS-backed secure credentials. No development renderer, model
  override, debug port, dialog-result fixture or renderer test bridge was used.
- A fresh profile displayed the empty Artifacts collection. Read-only API checks
  required HTTP 200, exactly `[]` for artifacts and exactly `{}` for content.
- The app was quit through its native menu, then relaunched using the earlier
  CSV review's separate profile. That profile retained exactly one Sheet with
  exact ID `artifact-new-2487ed5b274ce3088c122512`. The content library contained
  only that ID and its unique `native-artifact-quoted.xlsx` alias.
- Both keys returned the exact saved revision-one body: headers `Name`, `Value`;
  rows `Ada, Lovelace` / `=SUM(A1:A2)` and `Literal "quote"` / `0012`; note
  `Native review: imported values stay literal.`. Opening the canonical page
  through the native collection rendered all of those literal values and note.

The earlier CSV pass used the actual macOS file chooser, explicit review/adoption,
Create Sheet, native editing/Save, and the native XLSX Save dialog. Inspection of
the downloaded archive found literal shared strings rather than formulas. This
record does not claim completed TSV acceptance, source-absent CSV relaunch,
download byte-for-byte comparison, Intel execution, paid-provider behavior, or
signed/notarized release acceptance. No shared demo account state was changed.

The subsequent [native Sheet follow-up](native-sheet-2026-10-04.md) completes
the TSV workflow, source-absent CSV/TSV relaunch and native-download byte
comparisons on its explicitly recorded revisions. The other limits above remain.

## Automated locks

Before repair, nine store/first-boot tests failed on the fixture baseline,
unauthorized aliases, collisions, cross-registry ambiguity or stale rename
aliases. The new authenticated route test independently failed when Grace
received the ungranted seeded filename body. After repair, 51 focused store,
route, first-boot and access-parity tests passed. HTTP and remote MCP agree
before grant, while granted and after revocation. First-boot tests cover clean
desktop and hosted worlds plus persisted-world precedence on restart.

The complete repository verifier and final diff review remain the commit gate;
this narrow native record is not a replacement for those checks or the broader
release acceptance matrix.
