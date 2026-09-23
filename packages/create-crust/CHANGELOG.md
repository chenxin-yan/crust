# create-crust

## 0.4.0

### Patch Changes

- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0

## 0.3.6

### Patch Changes

- Updated dependencies []:
  - @crustjs/core@0.3.6

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @crustjs/core@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [[`26baf42`](https://github.com/chenxin-yan/crust/commit/26baf426534a2df0493a3be29c34f1574810fea1), [`9d19b33`](https://github.com/chenxin-yan/crust/commit/9d19b33a077247f47689b64e1babe1527638b9ed), [`52e0938`](https://github.com/chenxin-yan/crust/commit/52e0938ceee270340c366afb59f756d455d1623a), [`5183e78`](https://github.com/chenxin-yan/crust/commit/5183e78b60f263b4da820d3214863ef715d3dca4), [`2835c5b`](https://github.com/chenxin-yan/crust/commit/2835c5b1d2df03585c58c579d50e0ef6298138a0), [`cac21ad`](https://github.com/chenxin-yan/crust/commit/cac21ad6c9a57423aabf048cd3bf25223d52a1ae), [`b02c2af`](https://github.com/chenxin-yan/crust/commit/b02c2af97addd3e7064dff2155d6bf3b2a27c6cd), [`05603c9`](https://github.com/chenxin-yan/crust/commit/05603c9049edc0f0c7f74e6e22b8a69ecfe02dd6)]:
  - @crustjs/core@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [[`63ef15c`](https://github.com/chenxin-yan/crust/commit/63ef15c2a009c87cc568d1eab2d1011332417057)]:
  - @crustjs/core@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/core@0.3.2
  - @crustjs/create@0.1.3
  - @crustjs/progress@0.1.2
  - @crustjs/prompts@0.2.3

## 0.3.1

### Patch Changes

- [#403](https://github.com/chenxin-yan/crust/pull/403) [`41c69b6`](https://github.com/chenxin-yan/crust/commit/41c69b64866e52bdb4fed0797146fd1c7accb01b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Scaffolded projects are `"private": true`. The project is the build input, not the npm package: `crust publish` ships the staged `.crust/` packages (which are not private), so a stray `npm publish` in the project directory is now refused instead of uploading the source. `npm link` is unaffected.
- Updated dependencies []:
  - @crustjs/core@0.3.1

## 0.3.0

### Minor Changes

- [#386](https://github.com/chenxin-yan/crust/pull/386) [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/crust
  
  `crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.
  
  `crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<command>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.
  
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
  
  Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under the entry's isolated hook output directory while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the real entrypoint's nearest package root when running from source. It computes the path without checking whether the artifact directory exists.
  
  ### @crustjs/skills
  
  Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.

### Patch Changes

- [#390](https://github.com/chenxin-yan/crust/pull/390) [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Build every package.json bin source entry as a separate command, replacing crust.entry. Validate root names, reject duplicate entries and case-colliding command names, and merge isolated hook output with collision errors. Stage and validate all commands in root and platform packages. Scaffold runtime-specific source shebangs so npm link runs source; link .crust/root to exercise built output.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject a project directory whose basename is unsafe for template interpolation or the generated command (quotes, spaces, leading `.` or `-`, or Core's reserved `__proto__`) before writing, whether it comes from the positional argument, the prompt, or the current directory for `.`. Previously such names produced invalid package.json/TypeScript or unusable commands. This checks interpolation/bin safety, not the complete npm package-name rules.
- Updated dependencies [[`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d), [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d)]:
  - @crustjs/core@0.3.0
  - @crustjs/create@0.1.2
  - @crustjs/prompts@0.2.2

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.
- Updated dependencies [[`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d)]:
  - @crustjs/core@0.2.1
  - @crustjs/create@0.1.1
  - @crustjs/progress@0.1.1
  - @crustjs/prompts@0.2.1

## 0.2.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - - `create-crust` can be launched with npm, pnpm, Bun, or Deno (`npm create crust`, `bunx create-crust`, `deno run -A npm:create-crust`). It ships a single minimal template with binary/runtime distribution choices; the modular template, template-selection prompt, and `--template` flag are removed.
  - Confirmed overwrites now reach the scaffolder instead of aborting. `create-crust .` in a non-empty directory asks before writing; `--overwrite`/`--no-overwrite` pre-answer the confirmation.
  - Scaffolded projects depend on TypeScript 7 (`^7.0.2`); generated `tsc --noEmit` scripts are unchanged.
  - `@crustjs/create` runs post-scaffold `command` steps through the platform shell (`/bin/sh` or `cmd.exe`) instead of Bun Shell. Windows `.cmd`/`.bat` install and Git shims work under Node's CVE-2024-27980 hardening.
  - The `getGitUser` and `isGitInstalled` exports are removed from `@crustjs/create`; callers needing them must query Git themselves.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

### Patch Changes

- [#365](https://github.com/chenxin-yan/crust/pull/365) [`6ac32b5`](https://github.com/chenxin-yan/crust/commit/6ac32b5b4b1b10945d6ee410df8733ad87f45833) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `create-crust` locates its bundled templates relative to its own module. This fixes missing-template errors when launched through `npx`, `bun x`, or a wrapper that imports the CLI.

- [#354](https://github.com/chenxin-yan/crust/pull/354) [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add curried, extension-owned root metadata requirements with defineExtension<"version">()(id, configOrFactory). Required keys refine hook and artifact snapshots and are checked by strict TypeScript when installing extensions. version() now requires guaranteed root version metadata unless an explicit string or lazy provider is supplied; remove its runtime missing-version error. Keep ordinary defineExtension calls unchanged and put scaffold versions in root metadata. Root metadata now rejects statically known extra keys on pretyped objects as well as fresh literals; generic wrappers must also establish that their metadata contains only root keys.
- Updated dependencies [[`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0), [`59b8ec6`](https://github.com/chenxin-yan/crust/commit/59b8ec6ae3eae3da450d3297e375fee057296379), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`6ac32b5`](https://github.com/chenxin-yan/crust/commit/6ac32b5b4b1b10945d6ee410df8733ad87f45833), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996), [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95)]:
  - @crustjs/core@0.2.0
  - @crustjs/create@0.1.0
  - @crustjs/progress@0.1.0
  - @crustjs/prompts@0.2.0

## 0.0.31

### Patch Changes

- @crustjs/core@0.0.19
- @crustjs/create@0.0.7

## 0.0.30

### Patch Changes

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/core@0.0.18
  - @crustjs/create@0.0.6

## 0.0.29

### Patch Changes

- 173960e: Use bundled package versions for scaffolded `@crustjs/*` dependency ranges instead of `latest`.
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [8779692]
- Updated dependencies [67f815a]
- Updated dependencies [9db2613]
- Updated dependencies [3421dbf]
  - @crustjs/core@0.0.17
  - @crustjs/prompts@0.1.0
  - @crustjs/progress@0.0.4

## 0.0.28

### Patch Changes

- df08a3a: fix create crust typescript version
- Updated dependencies [7ca5e5f]
  - @crustjs/prompts@0.0.13
  - @crustjs/progress@0.0.3

## 0.0.27

### Patch Changes

- Updated dependencies [23fae62]
  - @crustjs/prompts@0.0.12

## 0.0.26

### Patch Changes

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.

- 291048b: Fix `create-crust` dependency installation on Windows and run `command` steps through Bun Shell for cross-platform shell execution.
- Updated dependencies [def425e]
- Updated dependencies [341f3b1]
- Updated dependencies [291048b]
  - @crustjs/core@0.0.16
  - @crustjs/progress@0.0.2
  - @crustjs/prompts@0.0.11
  - @crustjs/create@0.0.5

## 0.0.25

### Patch Changes

- @crustjs/prompts@0.0.10

## 0.0.24

### Patch Changes

- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.23

### Patch Changes

- 86e09aa: Rename `--distribute` build flag to `--package` across CLI, templates, and docs
- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.22

### Patch Changes

- a69c4d9: Add per-platform npm distribution workflow with `crust build --distribute` and `crust publish` commands. The build command now supports `--distribute` and `--stage-dir` flags to stage per-OS/arch npm packages with platform-specific binaries and shell/cmd resolvers. The new `publish` command publishes staged packages in dependency order. Updated `create-crust` binary distribution template to use the new distribute/publish workflow.

## 0.0.21

### Patch Changes

- Updated dependencies [6dea64c]
- Updated dependencies [819bad7]
  - @crustjs/core@0.0.13
  - @crustjs/prompts@0.0.9

## 0.0.20

### Patch Changes

- 9a216fd: Add distribution mode choice for scaffolded templates

  `create-crust` now asks whether you plan to distribute as standalone binaries or as a Bun runtime package, then scaffolds layered templates for the selected combination.

  Changes:

  - Added a new `Distribution mode` prompt during scaffolding
  - Refactored templates into composable layers: `base` + style variant (`minimal` / `modular`) + distribution variant (`binary` / `runtime`)
  - `Standalone binaries` mode keeps Crust packages in `devDependencies` and enables `prepack`
  - `Bun runtime package` mode moves `@crustjs/core` and `@crustjs/plugins` to `dependencies`, updates `build` to output `dist/cli.js`, and points `bin` to `dist/cli.js`
  - Updated template and installation docs to describe both distribution strategies

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.19

### Patch Changes

- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.18

### Patch Changes

- Updated dependencies [f704195]
  - @crustjs/prompts@0.0.8

## 0.0.17

### Patch Changes

- fda33c2: Add a new modular starter template that demonstrates the file-splitting subcommand pattern with `.sub()` and `.command(builder)`, and let users choose between Minimal and Modular template styles during scaffolding.
- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.16

### Patch Changes

- Updated dependencies [81608ea]
  - @crustjs/prompts@0.0.7

## 0.0.15

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- b17db37: Improve input prompt UX: `default` value is now shown as placeholder text when `placeholder` is not explicitly set, reducing API redundancy. When both are provided, `placeholder` is used visually and the default hint `(value)` still appears.

  Updated `create-crust` to collect all prompts before executing file operations, preventing partial scaffolding on mid-prompt cancellation. The project directory prompt now uses `default: "my-cli"` so users can press Enter to accept it.

- 4f4bddf: Add `isInGitRepo` utility to detect if a directory is inside an existing git repository.

  Updated `create-crust` to skip the "Initialize a git repository?" prompt when scaffolding inside an existing repo, preventing accidental nested `.git` directories.

- Updated dependencies [a1f233e]
- Updated dependencies [b17db37]
- Updated dependencies [e3624b2]
- Updated dependencies [4f4bddf]
  - @crustjs/core@0.0.9
  - @crustjs/prompts@0.0.6
  - @crustjs/create@0.0.4

## 0.0.14

### Patch Changes

- 55b588b: Update scaffold template path resolution to be package-root based for better generator DX.

  - In `@crustjs/create`, relative string `template` paths now resolve from the nearest package root discovered from `process.argv[1]` (instead of `process.cwd()`).
  - Absolute string paths are treated as-is, and `file:` URL templates remain supported.
  - Added coverage for package-root resolution and explicit error cases when no package root can be found.
  - Updated `create-crust` to use `template: "templates/base"`, aligned with package-root template resolution.

- Updated dependencies [55b588b]
  - @crustjs/create@0.0.3

## 0.0.13

### Patch Changes

- Updated dependencies [695854e]
  - @crustjs/prompts@0.0.5

## 0.0.12

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8

## 0.0.11

### Patch Changes

- Updated dependencies [1364768]
- Updated dependencies [967d2bf]
- Updated dependencies [e44d1c6]
- Updated dependencies [21298c8]
  - @crustjs/core@0.0.7
  - @crustjs/prompts@0.0.4

## 0.0.10

### Patch Changes

- 3d8b529: fix missing files field in package.json

## 0.0.9

### Patch Changes

- Updated dependencies [1b77051]
  - @crustjs/prompts@0.0.3

## 0.0.8

### Patch Changes

- Updated dependencies [f76fd1c]
- Updated dependencies [89f3828]
  - @crustjs/prompts@0.0.2

## 0.0.7

### Patch Changes

- da09867: Revamp scaffolding CLI: use `@crustjs/core` for command definition, `@crustjs/prompts` for interactive prompts, dynamic dependency installation via detected package manager, git-init confirmation prompt, and support scaffolding into the current directory with `.`.
- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- Updated dependencies [6e5d21d]
  - @crustjs/create@0.0.2

## 0.0.6

### Patch Changes

- 5110c83: Add `@crustjs/create` — a headless, zero-dependency scaffolding engine for building `create-xxx` tools.

  Provides `scaffold()` for template copying with `{{var}}` interpolation and dotfile renaming, `runSteps()` for declarative post-scaffold automation (install deps, git init, open editor, custom commands), and utilities for package manager detection and git user info.

  Refactor `create-crust` to use `@crustjs/create` as its scaffolding backend, replacing the inline implementation with the shared library (dogfooding).

- Updated dependencies [5110c83]
  - @crustjs/create@0.0.1

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
