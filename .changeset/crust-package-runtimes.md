---
"@crustjs/crust": minor
---

`crust build --package` now works for every runtime. Node stages a root-only npm package whose `bin/<command>.js` is the self-contained bundle (no launcher, no platform packages, no dependency fields), and Deno stages the same root-plus-platform-package layout as Bun with glibc-only Linux packages (closes #378). `crust publish` accepts both manifests.

The build runtime is inferred when neither `--runtime` nor `crust.runtime` is set: a `deno.json`/`deno.jsonc` selects Deno, `@types/node` without `@types/bun` selects Node, otherwise Bun. Every build prints `Runtime: <runtime> (<source>)`.

New `"crust": { "include": ["templates"] }` in `package.json` lists project directories that `--package` copies into the staged root package (and its `files`) and into each platform package's `bin/`, alongside Extension artifacts.
