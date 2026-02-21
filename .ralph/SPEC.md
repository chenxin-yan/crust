# @crustjs/validate

> Zero-runtime-dependency validation helpers for Crust CLI, optimized for schema-first DX.

## Overview

`@crustjs/validate` is a new Crust ecosystem module that adds ergonomic, type-safe validation workflows for CLI command inputs while preserving Crust's minimal design principles. The package targets developers who want strong validation and transformed output types without wiring repetitive validation boilerplate in each command.

The module is designed around two complementary modes. The first is a Zod 4 schema-first mode that prioritizes DX and allows command authors to define validation and CLI metadata in one colocated place. The second is a generic Standard Schema mode for library-agnostic validation wrappers, enabling interoperability with multiple validation libraries while keeping runtime dependencies at zero.

The package integrates directly with `@crustjs/core` command execution semantics, maps failures to `CrustError("VALIDATION")`, and preserves compatibility with `@crustjs/plugins` help rendering by generating command arg/flag metadata when schema-first mode is used.

## Scope

### Included

- New package `@crustjs/validate` in the monorepo with direct `@crustjs/core` integration.
- Two validation modes: root generic mode based on Standard Schema contracts for wrapper-style validation on existing commands, and Zod 4 schema-first mode via `@crustjs/validate/zod` with colocated CLI metadata helpers.
- Args/flags validation only for v1.
- Validation runs after Crust parsing and before command `run` execution.
- Framework-first coercion for CLI primitives before schema validation.
- Strict unknown-flag rejection behavior.
- Validation errors normalized to `CrustError("VALIDATION")` with human-readable bullet-list messages using dot-path formatting.
- Structured validation issues retained in `error.cause` for programmatic handling.
- Transformed schema outputs replace `context.args` and `context.flags` for handlers.
- Original pre-validation parsed values retained on `context.input` for advanced/debug use.
- Generated arg/flag metadata in schema-first mode supports help plugin output, with schema metadata taking precedence on conflicts.
- Experimental release posture for initial iterations.

### Excluded

- Env/config-file validation in v1.
- Async validation in v1 (sync-only pipeline).
- Automatic schema inheritance/merging across subcommand trees.
- JSON Schema export/generation utilities.
- Core runtime lifecycle hook changes in `@crustjs/core` (wrapper-based integration only).
- Schema-first auto-generation for non-Zod libraries in v1.

## Technical Stack

- **Language**: TypeScript (strict mode), ESM.
- **Runtime**: Bun + Node-compatible CLI runtime behavior through Crust core.
- **Core Integration**: `@crustjs/core` as peer dependency.
- **Schema Interop Standard**: Standard Schema (`@standard-schema/spec`) as type-level contract in generic mode.
- **Schema-First Provider (v1)**: Zod 4 in dedicated `/zod` entrypoint.
- **Build Tooling**: bunup, Biome, Turborepo (consistent with existing monorepo packages).
- **Testing**: `bun:test` with package-level unit and integration coverage.

## Architecture

`@crustjs/validate` provides a wrapper-driven validation layer that composes with existing `defineCommand` and execution flow instead of altering core runtime internals.

In generic mode, command authors keep normal Crust command definitions and add Standard Schema validation wrappers to handlers. This mode prioritizes compatibility and cross-library reuse but does not attempt automatic parser/help metadata derivation.

In `/zod` schema-first mode, the package provides a small metadata DSL colocated with Zod schemas to capture CLI-specific details not guaranteed by generic schema standards (argument names/order, aliases, descriptions). The mode materializes Crust-compatible arg/flag definitions so parser behavior and help plugin rendering remain first-class.

Validation result handling is consistent across modes: failures throw `CrustError("VALIDATION")`, successful parses may apply schema transforms, transformed values become the handler-facing `args/flags`, and original parsed input remains available for advanced use.

## Constraints

- Root package must have zero runtime dependencies.
- API surface should stay minimal and DX-first; avoid over-generalized abstractions in v1.
- Preserve Crust strict parsing semantics and error taxonomy.
- Do not require changes to `@crustjs/core` runtime lifecycle hooks.
- Keep compatibility with existing `@crustjs/plugins` help behavior.
- Maintain strong TypeScript inference for validated handler inputs.
- Treat v1 as experimental and evolve through explicit, documented compatibility expectations.

## References

- Standard Schema: `https://standardschema.dev`
- Standard Schema spec repo: `https://github.com/standard-schema/standard-schema`
- Standard Schema package: `https://www.npmjs.com/package/@standard-schema/spec`
- Zod: `https://zod.dev`
