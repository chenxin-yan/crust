# @crustjs/store

> A DX-first, typed persistence module for CLI applications with clear config/data/state/cache separation.

## Overview

`@crustjs/store` provides local persistence primitives for CLI apps in the Crust monorepo. The package should make persistent storage obvious and low-friction: users should pick a storage intent (config, data, state, cache), create a store with defaults, and read/write typed values without worrying about file paths, merge rules, or atomic disk behavior.

The current package is optimized for config-only persistence through field definitions. The target project behavior is broader: support application state and other store categories with the same ergonomic API, while keeping correctness and predictable platform behavior.

The primary users are TypeScript CLI authors building with Crust who want strong type inference, platform-aware paths, and simple operational semantics for common CLI persistence scenarios.

## Scope

### Included
- A single typed store API that supports nested object persistence, not only primitive field configs.
- First-class path helpers for `config`, `data`, `state`, and `cache` directories.
- XDG-based directory conventions on Unix platforms (Linux and macOS), with Windows using `%APPDATA%` and `%LOCALAPPDATA%` conventions.
- Atomic JSON persistence with predictable read/write/update/patch/reset behavior.
- Clear merge and validation semantics for defaults and persisted values.
- Documentation and examples focused on CLI developer experience and store intent selection.

### Excluded
- Remote/cloud synchronization, multi-device sync, or server-backed persistence.
- Cross-process distributed consistency guarantees beyond local atomic file replacement.
- Encryption, secrets management, or keyring integration as a core store responsibility.
- Domain-specific migration frameworks beyond simple store-level upgrade hooks.

## Technical Stack

- **Language**: TypeScript 5.x (ESM, strict typing)
- **Runtime**: Bun-native package behavior, Node 18+ compatibility
- **Persistence Format**: JSON files on local filesystem
- **Build**: bunup
- **Monorepo**: Turborepo workspaces
- **Lint/Format**: Biome
- **Testing**: bun:test

## Architecture

The package is structured around three concerns:
- **Path resolution layer** maps app names and store intent to platform-correct absolute directories.
- **Store runtime layer** handles read/write/update/patch/reset operations with atomic disk writes, JSON parsing, and error mapping.
- **Type layer** provides generic inference from defaults and store options so consumers get typed state without manual annotations in common cases.

Path helpers define location intent; store instances define data shape and behavior. This keeps location conventions and persistence mechanics decoupled while presenting a single, intuitive API surface.

## Constraints

- Developer experience is prioritized over backward compatibility with config-only API shapes.
- No `kind` field is required in store creation; intent comes from chosen path helper and naming.
- macOS follows XDG Unix conventions for consistency with Linux in this project.
- Store behavior must remain deterministic across platforms for merge, patch, and reset semantics.
- Public APIs must remain minimal, explicit, and easy to learn from examples.
- Changes must pass monorepo quality gates: `bun run check`, `bun run check:types`, and relevant tests.

## References

- XDG Base Directory Specification: https://specifications.freedesktop.org/basedir-spec/latest/
- env-paths reference implementation: https://github.com/sindresorhus/env-paths
- conf package conventions: https://github.com/sindresorhus/conf
