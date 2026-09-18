---
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/core": minor
"@crustjs/skills": minor
---

### @crustjs/crust

`crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.

Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. Use `crust build` followed by `crust publish`. Package identity comes from `package.json`; the command name comes from its single `bin` entry or the unscoped package name.

Use `--outfile` to bypass package staging and write one binary or Node bundle. Bun/Deno accept one target, defaulting to the host; Node does not accept `--target`. Windows binaries receive an `.exe` suffix when needed.

Runtime selection follows `--runtime`, then `package.json`'s `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. Set `crust.include` to copy asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.

### create-crust

Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime` and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.

Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.

`create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.

### @crustjs/core

Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under `.crust/artifacts/` while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the nearest package root when running from source. It computes the path without checking whether the artifact directory exists.

### @crustjs/skills

Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.
