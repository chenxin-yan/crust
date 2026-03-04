# @crustjs/crust

## 0.0.15

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10
  - @crustjs/plugins@0.0.12

## 0.0.14

### Patch Changes

- cae6ea2: Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. It is non-persistent by default, supports optional cache adapters (including `@crustjs/store`) for cross-run caching and dedupe, and uses package-manager-aware update commands with override support. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.
- Updated dependencies [cae6ea2]
  - @crustjs/plugins@0.0.11

## 0.0.13

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- e3624b2: Add pre-compile validation to `crust build`. Before compiling, the build command now spawns your entry file in a validation-only subprocess to check the full command tree (including plugin-injected flags and subcommands) for definition errors such as flag alias collisions and reserved `no-` prefix misuse. Disable with `--no-validate`.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9
  - @crustjs/plugins@0.0.10
  - @crustjs/style@0.0.4

## 0.0.12

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8
  - @crustjs/plugins@0.0.9

## 0.0.11

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7
  - @crustjs/plugins@0.0.8

## 0.0.10

### Patch Changes

- Updated dependencies [fe4d64d]
  - @crustjs/plugins@0.0.7

## 0.0.9

### Patch Changes

- 2d05fb1: Fix shell resolver failing to locate prebuilt binaries when invoked via symlink (e.g. from `node_modules/.bin/`). The resolver now follows symlinks to resolve the real script directory before looking up platform binaries.

## 0.0.8

### Patch Changes

- 8c11cd0: Replace `Bun.spawn` with programmatic `Bun.build()` API for compilation, enabling self-compiled standalone crust binaries that can compile user CLIs without a separate Bun installation. Add `--outdir/-d` flag for configurable output directory. Update resolver shebang to `#!/usr/bin/env bash`.

## 0.0.7

### Patch Changes

- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- 3b00b1d: Add `--resolver` (`-r`) flag to `crust build` for customizing the resolver script filename. Defaults to `cli` instead of `<name>.js`.
- 717180a: Replace Node.js resolver with POSIX shell script and Windows `.cmd` batch file for multi-target builds. The resolver no longer requires Node.js or Bun to dispatch to the correct platform binary.

## 0.0.6

### Patch Changes

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6
  - @crustjs/plugins@0.0.6

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish
- Updated dependencies [8e0b48a]
  - @crustjs/core@0.0.5
  - @crustjs/plugins@0.0.5

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types
- Updated dependencies [115d396]
- Updated dependencies [9b951e9]
- Updated dependencies [bdd101f]
- Updated dependencies [dcc258c]
  - @crustjs/core@0.0.4
  - @crustjs/plugins@0.0.4

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
- Updated dependencies
  - @crustjs/core@0.0.3
  - @crustjs/plugins@0.0.3
