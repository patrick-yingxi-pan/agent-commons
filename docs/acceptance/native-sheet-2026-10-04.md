# Native CSV/TSV Sheet acceptance — 2026-10-04 UTC

## Scope and result

Actual macOS file and Save dialogs now complement the fixture-driven
[`artifactSheetImportSmoke.mjs`](../../desktop/artifactSheetImportSmoke.mjs)
checks for CSV/TSV-to-Sheet authoring. Quoted CSV and headerless TSV were reviewed,
explicitly adopted, created, edited and downloaded as literal-value XLSX files.
Both saved artifacts retained their exact IDs, values, notes and revision after a
full app relaunch with their original source paths absent. Each native download
equals its current authorized export byte-for-byte before and after relaunch.

This is unsigned Apple Silicon development acceptance, not a signed release,
Intel execution, Microsoft Excel application test, formula calculation or rich
workbook import. No production code, permission, import policy or override changed.

## Artifact and isolation

- Agent Commons 0.1.0; Electron 44.0.0; macOS 26.5.2, build 25F84; arm64.
- TSV workflow and both source-absent restart checks: runtime corresponding to
  `d3753db24f6a0f2f644153c8ea1b661e31934305`, with app.asar SHA-256
  `648c3e6494f783c7dc4cc66c108489fca684085bbec633ae47e9c8e1fcfa832e`.
  The package was built from that commit's runtime working tree before its
  documentation and commit were finalized; no runtime source changed afterward.
- CSV selection, adoption, creation, edit and native download were performed
  earlier on `2abc976d496c779f3ea5f106aabd27a681006ab4`, as recorded in the
  [artifact-content regression review](artifact-content-2026-10-04.md).
  This follow-up verified its exact retained body and native download against
  the repaired runtime and completed the previously absent source-free restart.
- Ordinary executable launches used one isolated temporary SQLite profile and
  real OS-backed secure credentials. No model was configured or invoked. No
  debug port, mock Keychain, development renderer, native-dialog-result fixture
  or renderer test bridge was used. Shared demo accounts remained untouched.
- All product writes and native dialogs were driven through the app UI.
  Read-only loopback API comparisons supplied exact state/export evidence;
  archive inspection read the actual downloaded files.

## Observed workflow

| Case | Review and adoption | Canonical save and edit | Native download and source-absent relaunch |
| --- | --- | --- | --- |
| Quoted CSV | First row supplies `Name`, `Value`; comma inside a quoted cell and doubled quotation marks survive; leading zeros and formula-looking text stay literal | Stable exact ID; added note through Edit sheet and Save changes; revision 1 | Actual Save dialog download; 5,882 bytes; unchanged body and matching export after relaunch |
| Headerless TSV | Unchecked “First row contains column names”; generated `Column A`, `Column B`; both source rows retained | Name stayed blank and Create sheet disabled during review; no new artifact existed before adoption; explicit Use then Create saved one ID; note edit advanced to revision 1 | Actual Save dialog download; 5,858 bytes; unchanged body and matching export after relaunch |

The native chooser showed the exact TSV fixture selected before Open was used.
Review initially showed its first row as headers; unchecking the option visibly
restored it as data. Use imported sheet filled the editable fields and suggested
the `.xlsx` name. Only Create sheet added the second artifact and navigated to
its canonical page. While editing, Download XLSX was disabled with a save/cancel
explanation. Saving restored the read preview and enabled download.

Both Save dialogs targeted the generated fixture directory, not an unrelated
user document. After verifying downloads, the app was quit through its native
menu. Only the two generated CSV/TSV source fixtures were moved to a separate
temporary directory; the original paths were proven absent. The ordinary app
then restarted at a different loopback origin. Both artifact pages were opened
through the collection/sidebar and displayed the saved literal values and notes.

## Exact retained state

CSV artifact `artifact-new-2487ed5b274ce3088c122512`:

- Name: `native-artifact-quoted.xlsx`; revision: 1.
- Columns: `Name`, `Value`.
- Rows: `Ada, Lovelace` / `=SUM(A1:A2)`; `Literal "quote"` / `0012`.
- Note: `Native review: imported values stay literal.`
- Download SHA-256:
  `876790edb960909edc6f9c9a4de7e0d8ba3c8f6f29190ebb991c590d90f5d575`.

TSV artifact `artifact-new-3643515851b92bd70d294751`:

- Name: `native-artifact-headerless.xlsx`; revision: 1.
- Columns: `Column A`, `Column B`.
- Rows: `Ada` / `001`; `Grace` / `=SUM(B1:B2)`.
- Note: `Native review: headerless rows stay literal.`
- Download SHA-256:
  `ab073d09312518e1246a650a758c5816cba2ae7d01d1100ff1fa2b506f66a5e4`.

Before and after restart, the artifact registry contained exactly these two
identities. The content library contained only their exact IDs and unique name
aliases, with no demo library. Both exports returned revision 1 and bytes equal
to the files saved by the native dialogs. ZIP CRC checks passed; worksheet cells
use shared-string types, all expected values and notes occur in the shared
strings, and there are no worksheet formula nodes.

## Remaining gates

This two-case native walk complements, rather than replaces, the parser bounds,
invalid-input, replacement/cancellation, account lifetime, sharing, CAS and
browser-rendering tests. It is not the full input/error matrix on every supported
platform. XLSX workbook identity and tabs, rich Office fidelity, formula execution,
signed/notarized extracted ZIPs, native Intel and external-service acceptance
remain outside this evidence.
