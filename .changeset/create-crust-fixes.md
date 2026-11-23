---
"create-crust": patch
---

Generated projects get a test and a `start` script that runs the binary, and the initializer fails when it cannot ask before writing into an existing folder.

- New projects contain `src/app.ts` (the CLI), `src/cli.ts` (runs it), and `src/app.test.ts`, one test of the CLI's output with `captureExecute()` from `@crustjs/testing`, run by the new `test` script (`bun test`, or `node --test` for Node.js).
- A binary project's `start` script runs the built launcher with Node.js, which runs the binary for this machine. It used to run the launcher with Bun, which drops a `--` argument.
- Run by path, with no package manager in the environment, the initializer uses the selected runtime's package manager (bun for Bun, npm for Node.js) for installation and the next steps.

**Behavior change:** when the destination exists (or the current directory is not empty) and the prompt cannot be shown (no terminal, or `CI` set) or `--no-overwrite` is given, the initializer prints `Directory "my-cli" already exists. Pass --overwrite to write into it.` on standard error and exits 1. It used to print `Aborted.` on standard output and exit 0, which it still does when the prompt is answered no.
