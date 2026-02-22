# @crustjs/create

> A headless, zero-dependency scaffolding engine for building `npm create-xxx` / `bun create-xxx` tools.

## Overview

`@crustjs/create` is a general-purpose library for building project scaffolding tools (the `create-xxx` pattern). It handles the mechanical parts of scaffolding — copying template directories, interpolating variables into file contents, renaming dotfiles, resolving directory conflicts, and running post-scaffold steps — so the consumer focuses purely on their template design and interactive flow.

The library is **headless**: it has no opinions about prompts, CLI frameworks, or terminal UI. Users pair it with `@crustjs/core` for command routing/parsing and `@crustjs/prompts` (forthcoming) for interactive input. `@crustjs/create` is the missing scaffolding primitive between those layers.

It prioritizes DX for scaffolding tool authors: templates live as real files on disk (not string constants), composition is explicit via multiple `scaffold()` calls, and post-scaffold automation is declarative.

## Scope

### Included

- File-based template engine with `{{var}}` interpolation (variables only, no conditionals/loops)
- Template path resolution relative to `import.meta` of the calling module
- Dotfile rename convention (`_gitignore` -> `.gitignore`)
- Directory conflict resolution (overwrite or abort)
- Declarative post-scaffold step runner (install deps, git init, open editor, custom commands)
- Package manager detection utility (bun/npm/pnpm/yarn)
- Git helper utilities (detect git, read git user info)
- Composable design — call `scaffold()` multiple times to layer templates

### Excluded

- Interactive prompts (belongs in `@crustjs/prompts`)
- Terminal UI / styled output (headless — no `@crustjs/style` dependency)
- Template-level conditionals or loops (`{{#if}}`, `{{#each}}`)
- Dynamic filename interpolation (filenames are static)
- Built-in variant/overlay merging system (user controls composition explicitly)
- CLI argument parsing (user uses `@crustjs/core` or any CLI framework)

## Technical Stack

- **Language**: TypeScript 5.x (strict mode, `verbatimModuleSyntax`)
- **Runtime**: Bun-native (uses `node:fs`, `node:path`, `node:child_process` built-ins)
- **Build**: bunup (ESM output + TypeScript declarations)
- **Testing**: bun:test (unit tests co-located, integration tests in `tests/`)
- **Linter/Formatter**: Biome (monorepo-shared config)
- **Dependencies**: Zero runtime dependencies
- **Peer dependencies**: `@crustjs/core`

## Architecture

The library exposes a small, composable API surface organized into three areas: the core scaffold function, declarative post-scaffold steps, and standalone utilities.

### Core Function: `scaffold()`

```ts
async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult>
```

Copies a single template directory to a destination, applying variable interpolation and dotfile renaming. Users call it multiple times to compose/layer templates — for example, a base template followed by a TypeScript-specific overlay. This keeps conditional logic in the user's command handler rather than in the library.

### Template Resolution

Template paths are specified relative to the calling file and resolved via an `import.meta.url` reference the user passes in. This ensures templates bundled inside published npm packages resolve correctly regardless of where the package is installed.

### Interpolation Engine

Minimal `{{var}}` replacement in file contents. No conditionals, no loops, no helpers. Variables are provided as a flat `Record<string, string>` context object. Files that aren't text (detected via null-byte check) are copied as-is without interpolation.

### Dotfile Handling

Files prefixed with `_` in the template directory are renamed to start with `.` during scaffold. For example, `_gitignore` becomes `.gitignore`. This works around npm/bundler behavior that strips dotfiles during publish.

### Directory Conflict Resolution

Before writing files, `scaffold()` checks if the destination exists. Behavior is controlled by a `conflict` option:

- `"overwrite"` — replace existing files
- `"abort"` — throw an error (default)

### Post-Scaffold Steps

Declarative array of step objects executed in order after file generation:

```ts
type PostScaffoldStep =
  | { type: "install" }
  | { type: "git-init"; commit?: string }
  | { type: "open-editor" }
  | { type: "command"; cmd: string; cwd?: string }
```

- `install` — detect package manager and run install
- `git-init` — run `git init`, optionally make an initial commit with the provided message
- `open-editor` — open the scaffolded project in `$EDITOR` or VS Code
- `command` — run an arbitrary shell command

### Utilities

Standalone helper functions for common scaffolding needs:

- `detectPackageManager()` — detect bun/npm/pnpm/yarn from lockfiles or npm user agent
- `getGitUser()` — read `user.name` and `user.email` from git config
- `isGitInstalled()` — check if git is available on the system

## Constraints

- Zero runtime dependencies — only Node built-ins
- `@crustjs/core` as peer dependency (signals the intended usage pattern, not a hard runtime import)
- All public APIs have JSDoc with `@example` blocks
- Templates are real files on disk, never string constants in code
- No magic — composition and conditionals are handled by the user in their command logic
- Follows all Crust monorepo conventions (Biome, naming, imports, section dividers, barrel exports)
- Existing `create-crust` package will be refactored to use `@crustjs/create` as dogfooding validation

## References

- Existing `create-crust` package (`packages/create-crust`) — will be refactored to use `@crustjs/create`
- [create-vite](https://github.com/vitejs/vite/tree/main/packages/create-vite) — prior art for file-based template approach
- [giget](https://github.com/unjs/giget) — prior art for template fetching
- [degit](https://github.com/Rich-Harris/degit) — prior art for scaffolding from git repos
