# @crustjs/crust

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
