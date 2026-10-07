# Native startup restore acceptance 2026-10-06

## Scope and result

Actual macOS backup selection, replacement confirmation and Electron-managed
automatic relaunch restored an exact saved Document from a damaged SQLite test
profile. Both picker and confirmation cancellation now quit cleanly without
changing the damaged database or creating a safety copy.

The first manual cancellation exposed a windowless-process bug. Failed-start
recovery now has one lifecycle owner: only an explicit restarting outcome leaves
exit to the restore operation; cancellation and failures use ordinary app Quit.
The new behavioral and main-wiring locks were watched fail before acceptance.

## Package and isolation

- Agent Commons 0.1.0, Electron 44.0.0, macOS 26.5.2 build 25F84, arm64.
- Base revision `20cbfffd6e50ada3fa8d27d6f58c259f0dd34ea4` plus the startup
  cancellation fix committed with this record. Packaged app.asar SHA-256:
  `892b8db100f67c2630c410c416b18d116916ed8459389c430777fc7dd095c620`.
  Main, startup recovery, restore protocol/lifecycle and SQLite replacement
  modules byte-matched the source tree before the fixed-package review.
- Test data lived in one newly generated mode-0700 temporary profile. Native UI
  created the baseline Document, managed backup and distinct newer Document.
  After clean Quit, the generated healthy SQLite file was moved aside and an
  invalid text fixture took its place. No user database was corrupted or restored.
- Ordinary executable launches used only the isolated user-data argument, with
  ambient provider/model, development-renderer and persistence overrides unset.
  There were no mock-Keychain switches, debugging ports, inspector, dialog-answer
  fixtures or renderer test bridges. No provider or personal token was configured.
- Exact-state checks used public read-only artifact endpoints and local hashes.
  The generated original database, restored profile and backups are retained;
  all test processes are stopped. The shared Ada development preview was unchanged.

## Observed recovery

| Boundary | Evidence |
| --- | --- |
| Regression | On the prior package, picker Cancel left the failed-start process alive without a usable window. Only that stranded test process was terminated before rebuilding. |
| Picker Cancel | The rebuilt process exited zero. The damaged bytes and the two existing snapshot files stayed unchanged. |
| Confirmation Cancel | Selecting the exact managed backup showed the native no-fresh-safety-copy warning and default Cancel. Cancel exited zero with the damaged database and authentication root unchanged. |
| Confirmed restore | Restore and restart logged the chosen filename, exited zero and automatically started a new process with the same isolated profile. The successor existed before any UI inspection; no manual launch supplied it. |
| Exact replacement | The restored collection contained only the baseline artifact, with its original identity and exact two-paragraph body. The newer marker artifact was absent. Native accessibility, screenshot and read-only HTTP agreed. |
| Preserved boundaries | The device authentication root and both empty credential-vault files were byte-identical. Both existing backups retained their hashes; there was no additional safety copy. The restored app quit through its native menu. |

The chosen backup was
`backup-2026-10-07T02-43-06-538Z-da5a4553cffbf0d8.json`, SHA-256
`1a878aee4374b0d7e9e17b7cc2f02e8a99d1553fc97623fa2462de09423d1d9b`.
Its UTC filename falls on October 7; this review occurred on October 6 local time.
The restored artifact identity is `artifact-new-dcf3739093fe357a3b24ec4e`.
Its canonical body is:

```json
{"type":"doc","title":"restore-baseline","blocks":[{"p":"Native recovery baseline 641."},{"p":"This exact text must return after damaged-database recovery."}],"revision":0}
```

The JSON-serialized body SHA-256 is
`e60c176860b2a549639a05a1dd1e9166f83fefbd126496314d861ece5b22b0af`.

## Control limitations and release gates

After the successful picker cancellation, a native accessibility inspection
unexpectedly launched a separate instance without the isolated-profile argument.
That normal-profile instance was immediately closed through Quit without UI
edits; ordinary startup may have performed its usual local housekeeping. It is
not recovery evidence. Subsequent exit checks used process status, and the true
restore successor's exact profile argument was verified before UI inspection.

The full local packaged verifier passed separately, including the fixture-driven
healthy/safety-copy/damaged restore matrix and ordinary OS-backed storage checks.
This manual record adds actual dialogs and automatic relaunch on one unsigned
arm64 build. It does not establish populated-vault or personal-token recovery,
rotated/deleted credential recovery, signed/notarized acceptance, or native Intel
behavior. Those retain their separate automated and release gates.
