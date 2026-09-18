---
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/core": minor
"@crustjs/skills": minor
---

### @crustjs/crust

`crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.

`crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<name>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.

Build configuration lives in one `package.json` block; unknown keys under `crust` are an error:

```json
{
  "crust": {
    "runtime": "bun",
    "entry": "src/cli.ts",
    "bunPlugins": ["@opentui/solid/bun-plugin"],
    "include": ["templates"]
  }
}
```

Runtime selection follows `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. `crust.entry` defaults to `src/cli.ts` and must stay inside the project. `crust.bunPlugins` replaces `--bun-plugin` with the same resolution (bare names from `node_modules`, paths from the project root, default export); Deno rejects it. `crust.include` copies asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.

`@crustjs/crust` ships a JSON schema for the `crust` block at `node_modules/@crustjs/crust/schema/package.json` (extending SchemaStore's package.json schema) for editor completion; point `"$schema"` at it in `package.json`.

`crust publish` keeps `--tag`, `--dry-run`, and `--registry`; removed `--access` and `--verify`. Staged metadata is always verified, and npm is run without `--access`, so scoped public packages need `publishConfig.access: "public"` in `package.json` (copied into every staged package). `npm publish` runs inside each `.crust/<package>` directory, so a project-level `.npmrc` is not read; use trusted publishing, `NPM_CONFIG_USERCONFIG`, or `~/.npmrc`.

### create-crust

Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime` and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.

Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.

Generated `package.json` files start with `"$schema": "./node_modules/@crustjs/crust/schema/package.json"` so editors complete and validate the `crust` block.

`create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.

### @crustjs/core

Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under `.crust/artifacts/` while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the nearest package root when running from source. It computes the path without checking whether the artifact directory exists.

### @crustjs/skills

Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.
