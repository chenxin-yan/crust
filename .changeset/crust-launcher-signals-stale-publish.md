---
"@crustjs/crust": patch
---

The generated npm launcher now forwards `SIGTERM` and `SIGHUP` to the platform binary, stays alive through Ctrl-C while the binary cleans up, and exits with the binary's exit code or signal. Previously the binary was orphaned on `SIGTERM` and its exit code was lost on Ctrl-C. A `SIGINT` sent only to the launcher's PID is not forwarded, because Ctrl-C already reaches the binary.

`crust publish` now fails with "Stage is stale" when the project `package.json` name or version differs from what `crust build` staged in `.crust/`; run `crust build` again.

`build({ targets })` suggests known target names in editors.
