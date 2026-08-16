---
"@crustjs/core": minor
"@crustjs/crust": minor
"@crustjs/man": minor
---

Replace the two-variable validation mode with a single subprocess-only snapshot-file protocol. Build validation and Extension artifact generation now share one entrypoint run, and man-page generation no longer requires the entry module to export its app.

`@crustjs/core/tooling` now exports `SNAPSHOT_PATH_ENV` instead of `VALIDATION_MODE_ENV` and `VALIDATION_FORCE_EXIT_ENV`. `writeManPage` now accepts a prepared Command Snapshot as `root` instead of a live app as `app`.

Entries that never call `await app.execute()` (or are not Crust CLIs at all) previously passed build validation vacuously; they now fail with an actionable missing-snapshot error. Use `--no-validate` if you intentionally build such an entry.
