---
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/core": minor
"@crustjs/skills": minor
---

### @crustjs/crust

`crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.

`crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<command>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.

The standard `bin` field declares what is built: each key is an installed command and each value is its TypeScript source entry. Every entry gets its own `bin/<command>.js` in the root package and its own `<command>-<target>` binary in each platform package (one platform package per target, never per command). A string `bin` is the entry of one command named after the unscoped package name; without `bin`, `src/cli.ts` is built under that name. Entries must be files inside the project and may not be shared between commands (compared by real path); command names may not differ only by case. During a validated build each entry's root command must be named after its `bin` key (`new Crust("my-cli-admin")` for `"my-cli-admin": "src/admin.ts"`); `--no-validate` skips that check along with Extension build hooks. Each entry's hooks run in an isolated directory and their output is merged into `.crust/artifacts/`, failing on any path two entries both write. `.crust/manifest.json` lists `root.bins` and each platform package's `bins` map, and `crust publish` verifies every command. Because `bin` values are source files, `npm link` runs the source through its shebang; link `.crust/root` to use the built distribution.

Build configuration lives in one `package.json` block; unknown keys under `crust` are an error:

```json
{
  "bin": { "my-cli": "src/cli.ts" },
  "crust": {
    "runtime": "bun",
    "bunPlugins": ["@opentui/solid/bun-plugin"],
    "include": ["templates"]
  }
}
```

Runtime selection follows `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. `crust.bunPlugins` lists Bun bundler plugin modules: bare names resolve from `node_modules`, paths from the project root, each default-exporting the plugin; Deno rejects it. `crust.include` copies asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.

`@crustjs/crust` ships a JSON schema for the `crust` block at `node_modules/@crustjs/crust/schema/package.json` (extending SchemaStore's package.json schema) for editor completion; point `"$schema"` at it in `package.json`.

`crust publish` keeps `--tag`, `--dry-run`, and `--registry`; removed `--access` and `--verify`. Staged metadata is always verified. npm reads `publishConfig.access` from each staged `package.json`, so scoped public packages need `publishConfig.access: "public"` in `package.json` (copied into every staged package). `npm publish` runs inside each `.crust/<package>` directory, so a project-level `.npmrc` is not read; use trusted publishing, `NPM_CONFIG_USERCONFIG`, or `~/.npmrc`.

### create-crust

Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime`, point `bin` at `src/cli.ts` (which starts with the runtime's shebang: `#!/usr/bin/env bun`, `#!/usr/bin/env node`, or `#!/usr/bin/env -S deno run -A`, so `npm link` runs the source), and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.

Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.

Generated `package.json` files start with `"$schema": "./node_modules/@crustjs/crust/schema/package.json"` so editors complete and validate the `crust` block.

`create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.

### @crustjs/core

Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under `.crust/artifacts/` while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the nearest package root when running from source. It computes the path without checking whether the artifact directory exists.

### @crustjs/skills

Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.
