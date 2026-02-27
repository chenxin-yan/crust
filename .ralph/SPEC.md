# Crust Validation Platform

> Universal schema validation for command input, interactive prompts, and persisted config.

## Overview

Crust needs one validation system that works consistently across three different input surfaces: CLI command args/flags, interactive prompt answers, and JSON config loaded from the store. Today, command validation is first-class in `@crustjs/validate`, while prompts and store use separate patterns. This creates fragmented developer experience and repeated validation logic.

The project introduces a universal validation platform centered on the Standard Schema contract, with target adapters for `command`, `prompt`, and `store`. Users define schemas once (Zod, Effect, or any Standard Schema-compatible library), then use target-specific adapters without rewriting validators or error handling rules.

The goal is best-in-class DX: one mental model, consistent errors, strong typing, and minimal boilerplate for real CLI workflows that combine flags, prompts, and persisted config.

## Scope

### Included
- A first-class Standard Schema entrypoint as the universal runtime contract for validation.
- Provider-specific schema support through `@crustjs/validate/zod` and `@crustjs/validate/effect` as thin wrappers.
- First-class target adapters for command execution, prompt validation, and store config validation.
- A shared validation core that normalizes issues, error shape, and message rendering across all targets.
- Typed APIs that preserve transformed schema output where target contracts allow it.
- Store integration that validates both writes and reads by default to prevent silent config drift.

### Excluded
- New schema providers beyond Zod and Effect in this revision.
- Form-builder style prompt generation from object schemas.
- Automatic migration of invalid persisted config.
- Runtime plugin loading or dynamic provider discovery.
- Full command parser metadata inference from every schema library without explicit metadata fallbacks.

## Technical Stack

- **Language**: TypeScript 5.x (strict mode), ESM.
- **Runtime**: Bun-native monorepo with Turborepo.
- **Universal Schema Contract**: Standard Schema (`@standard-schema/spec`).
- **Validation Providers**: Zod v4 and Effect Schema.
- **CLI Core Integration**: `@crustjs/core` command context and lifecycle hooks.
- **Prompt Integration**: `@crustjs/prompts` validate-function contract.
- **Config Integration**: `@crustjs/store` typed config store.
- **Testing**: `bun:test` unit and integration tests.

## Architecture

Validation is organized as a two-axis model: **contract/provider x target**.

- **Contract layer** (`standard`): Standard Schema-compatible `validate` execution and result handling.
- **Provider layer** (`zod`, `effect`): thin wrappers around `standard` plus provider-specific command DSL ergonomics.
- **Core validation layer** (`@crustjs/validate` internals): normalized issue model, path formatting, error rendering, and target-independent validation result contract.
- **Target adapters**:
  - **Command adapter**: validates args/flags and produces validated command context.
  - **Prompt adapter**: converts schemas to prompt-compatible validators and supports typed parsing helpers.
  - **Store adapter**: validates config objects for persistence and load-time integrity.

Public API organization favors direct discoverability:

- `@crustjs/validate/standard` exports universal adapters for prompt, store, and low-level validation.
- `@crustjs/validate/zod` and `@crustjs/validate/effect` export the same target surface, delegating runtime validation to `standard`.
- Command APIs support explicit parser metadata when automatic schema inference is ambiguous.

The platform enforces the same issue structure and `VALIDATION` error behavior regardless of where invalid input originates.

## Constraints

- API design optimizes for DX over backward compatibility in this revision.
- Prompt and store integrations must feel first-class, not utility add-ons.
- Error behavior must be deterministic and consistent across command, prompt, and store.
- Store validation must be strict by default (invalid persisted config fails loudly).
- Package boundaries must remain clean: providers stay in `@crustjs/validate`; targets consume contracts without embedding provider logic.
- Runtime validation logic should be written once against Standard Schema wherever possible.
- All code must pass `bun run check` and `bun run check:types` at monorepo root.

## References

- `packages/validate/src/middleware.ts`
- `packages/validate/src/validation.ts`
- `https://standardschema.dev`
- `packages/validate/src/zod/withZod.ts`
- `packages/validate/src/effect/withEffect.ts`
- `packages/prompts/src/core/types.ts`
- `packages/store/src/store.ts`
