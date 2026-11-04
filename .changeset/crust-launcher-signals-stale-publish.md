---
"@crustjs/crust": patch
---

The generated npm launcher now forwards `SIGTERM` and `SIGHUP` to the platform binary, stays alive through Ctrl-C while the binary cleans up, and exits with the binary's exit code or signal. Previously the binary was orphaned on `SIGTERM` and its exit code was lost on Ctrl-C. On POSIX, a `SIGINT` sent to the launcher's PID is forwarded only when no terminal is attached (CI, containers, service managers); in a terminal, Ctrl-C already reaches the binary, so it is not sent twice.

`crust publish` now fails with "Stage is stale" when the project `package.json` name or version differs from what `crust build` staged in `.crust/`; run `crust build` again.

`build({ targets })` suggests known target names in editors.
