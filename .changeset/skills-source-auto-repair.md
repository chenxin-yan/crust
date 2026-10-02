---
"@crustjs/skills": patch
"@crustjs/utils": patch
---

Skip the skills pre-run link repair when a CLI runs from source (`bun run`, `node`, `deno run`). Previously any source command, even `--version`, repointed every owned skill link, including global ones, to the checkout's `.crust/root/skills`, taking them from the installed CLI until its next run moved them back. An installed CLI (a Crust-built bundle or compiled executable) still repairs stale or dangling links before commands, and `skills install` and `skills repair` still work from source. `@crustjs/utils/artifacts` exports `isSourceRun()`, which reports that mode.
