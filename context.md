# Code Context: Raw Schema-Backed Validation

## Files Retrieved

### packages/core (Parser & Types)
1. `packages/core/src/parser.ts` (lines 1-430) — Main CLI arg/flag parser; wraps Node's `util.parseArgs` with type coercion, alias resolution, variadic args, and validation separation
2. `packages/core/src/types.ts` (lines 1-700+) — Core type definitions: `ArgDef`, `FlagDef`, `FlagsDef`, `ValueType` (string|number|boolean), type inference via `InferArgs<A>` and `InferFlags<F>`, flag inheritance and alias collision detection at compile-time

### packages/validate (Schema-Driven Validation)
3. `packages/validate/src/schema.ts` (lines 1-250+) — `arg()` and `flag()` functions; wrap Standard Schema v1 to produce core `ArgDef`/`FlagDef` with hidden `[VALIDATED_SCHEMA]` brand; auto-infer CLI metadata (type, required, description) via vendor dispatch (`inferOptions` from `@crustjs/utils/schema`)
4. `packages/validate/src/middleware.ts` (lines 1-180) — `buildValidatedRunner()` function; reads `[VALIDATED_SCHEMA]` off each arg/flag def, validates parsed values concurrently, collects issues, throws `CrustError("VALIDATION")` or calls handler with `ValidatedContext` (includes original unparsed input for debugging)
5. `packages/validate/src/command.ts` (lines 1-60) — `commandValidator()` handler factory; wraps `buildValidatedRunner` with strict type checking (`CommandValidatorHandler<A, F>`)
6. `packages/validate/src/schema-types.ts` (lines 1-260+) — Branded types: `ArgDef$<Name, S, Variadic>`, `FlagDef$<S, Short, Aliases, Inherit>` carrying `[VALIDATED_SCHEMA]` symbol; type-level inference of CLI value-type from schema input/output; `InferValidatedArgs<A>`, `InferValidatedFlags<F>` for handler parameter typing
7. `packages/validate/src/types.ts` (lines 1-90) — Public API types: `StandardSchema`, `ValidatedContext`, `ValidationResult` (success | failure discriminated union), `ValidationIssue`
8. `packages/validate/src/validate.test.ts` (lines 1-500+) — Core validation logic tests: `isStandardSchema`, `normalizeStandardPath`, `validateStandard`, `normalizeStandardIssues`, fallback sync `validate(undefined)` for default extraction
9. `packages/validate/src/command.test.ts` (lines 1-1000+) — End-to-end command validation tests; parameterized suite for Zod and Effect fixtures; tests arg/flag parsing, schema validation, type narrowing, inheritance, async refinements, transformation, vendor-specific quirks

### packages/store (Field Definitions & Persistence)
10. `packages/store/src/field.ts` (lines 1-280+) — `field(schema, opts?)` factory; wraps Standard Schema v1 for store fields; infers `type`, `array`, `description`, `default` via vendor dispatch; returns `FieldDef` with async `validate` function that throws on invalid input or returns `{ value: ... }` for transformations; overloaded signatures for narrowed defaults
11. `packages/store/src/merge.ts` (lines 1-50) — `applyFieldDefaults(persisted, fields, pruneUnknown?)` function; merges persisted values with field defaults, shallow-copies arrays to avoid mutation, optionally prunes unknown keys
12. `packages/store/src/types.ts` (lines 1-350+) — Store field type contracts: `FieldDef` (discriminated by `type` × `array`), `FieldsDef`, `InferStoreConfig<F>` type inference, `ValueType`, per-field `validate` contract and shape (void | `{ value }` | thrown error)
13. `packages/store/src/field.test.ts` (lines 1-300+) — Field factory tests: shape inference, default extraction (Zod, Effect, vendor-neutral sync fallback), validation adapter, vendor-specific quirks (falsy defaults, async validation)
14. `packages/store/src/merge.test.ts` (lines 1-250+) — Default merging tests: persisted full/partial match, missing fields, array shallow-copy behavior, unknown key pruning

### packages/utils (Schema Introspection — INTERNAL)
15. `packages/utils/src/schema/index.ts` (lines 1-25) — Internal subpath exports; `assertStandardSchema`, `isStandardSchema`, `inferOptions`, `extractDefault`, `normalizeStandardIssues`, `formatPath`, type aliases (`StandardSchema`, `InferInput`, `InferOutput`, `ValidationIssue`)
16. `packages/utils/src/schema/introspect.ts` (lines 1-150+) — Vendor dispatch registry: `inferOptions(schema, kind, label)` routes on `schema["~standard"].vendor`; Zod adapter walks `_zod.def` at runtime; Effect adapter inspects `AST` (requires ≥ 3.14.2); unknown vendors return `{}`; `extractDefault(schema)` tries vendor-specific sync extraction then falls back to sync `validate(undefined)`
17. `packages/utils/src/schema/types.ts` (lines 1-30) — Type aliases: `StandardSchema<Input, Output>`, `InferInput<S>`, `InferOutput<S>` wrapping Standard Schema v1 spec

## Key Code

### Standard Schema Brand (`VALIDATED_SCHEMA`)
```typescript
// packages/validate/src/schema-types.ts
export const VALIDATED_SCHEMA: unique symbol = Symbol.for("crustjs.validate.schema");

// Attached by arg() and flag()
export interface ArgDef$<Name extends string, S extends StandardSchema, Variadic> {
  readonly name: Name;
  readonly type: Type; // inferred from S
  readonly variadic: Variadic;
  readonly [VALIDATED_SCHEMA]: S; // Hidden schema metadata
}
```

### Middleware Validation Loop
```typescript
// packages/validate/src/middleware.ts
export function buildValidatedRunner(
  userRun: (ctx: ValidatedContext<unknown, unknown>) => void | Promise<void>,
  validateValue: ValidateValueFn = validateStandard,
  label = "commandValidator"
): (context: CrustCommandContext) => Promise<void> {
  return async (context: CrustCommandContext) => {
    const issues: ValidationIssue[] = [];
    
    // For each arg/flag def:
    // 1. Extract [VALIDATED_SCHEMA] if present
    // 2. Validate parsed value against schema (await-safe)
    // 3. Collect issues; track transformed values
    // 4. Throw CrustError("VALIDATION") with issue list, or call handler
  };
}
```

### Field Factory with Type Narrowing
```typescript
// packages/store/src/field.ts
export function field<S extends StandardSchema>(schema: S): SchemaFieldDef<S>;
export function field<S extends StandardSchema, D extends InferOutput<S>>(
  schema: S,
  opts: FieldOptions<InferOutput<S>> & { default: D }
): SchemaFieldDefWithDefault<S, D>;

// Returned FieldDef carries async validate() that returns { value } on success
```

### Vendor-Dispatch Introspection
```typescript
// packages/utils/src/schema/introspect.ts
export function inferOptions(
  schema: StandardSchema,
  kind: "arg" | "flag" | "field",
  label: string
): InferredOptions {
  const vendor = schema["~standard"]?.vendor;
  
  if (vendor === "zod") return inferFromZod(schema);
  if (vendor === "effect") return inferFromEffect(schema, label);
  return {}; // Unknown vendor — user must supply opts explicitly
}

export function extractDefault(schema: StandardSchema): ExtractedDefault {
  // 1. Try vendor-specific sync extraction (Zod, Effect)
  // 2. Fall back to schema["~standard"].validate(undefined)
  // 3. Return { ok: true, value } or { ok: false }
}
```

## Architecture

### Data Flow: arg() → commandValidator

1. **Definition Phase** (`arg()`, `flag()`):
   - User passes Standard Schema v1 (Zod natively, Effect wrapped via `Schema.standardSchemaV1(...)`)
   - `inferOptions()` vendor-dispatches to extract CLI metadata (type, required, description)
   - Schema is attached to core `ArgDef`/`FlagDef` via `[VALIDATED_SCHEMA]` symbol
   - Returned object satisfies core's discriminated union (type narrowing intact)

2. **Parse Phase** (core `parser.ts`):
   - Core parser runs unaware of schemas; produces typed `ParseResult<A, F>`
   - Returns `{ args, flags, rawArgs }` with schema-naive values

3. **Validation Phase** (`buildValidatedRunner`):
   - Iterates `context.command.args` and `context.command.effectiveFlags`
   - For each def with `[VALIDATED_SCHEMA]`, calls `schema["~standard"].validate(parsedValue)`
   - Handles both sync and async validators (await-safe)
   - Collects normalized `ValidationIssue[]` across all schemas
   - On failure: throws `CrustError("VALIDATION")` with issues list
   - On success: calls user handler with `ValidatedContext` (transformed values + original input)

4. **Store Field** (`field()`):
   - Similar to `arg()`/`flag()` but for persistence config
   - Wrapped schema's `validate()` returns `{ value }` to enable transformations
   - Store persists transformed output; on read, returns on-disk value verbatim
   - Read-stability guard re-validates transformed value on write to catch type mismatches

### Type Narrowing Chain

```
schema: StandardSchema<Input, Output>
  ↓ [arg/flag/field]
CLI ValueType inferred from Input/Output
  ↓
Def type literal (e.g., FlagDef$ with type: "string")
  ↓
Handler parameter type (ValidatedContext w/ InferValidatedArgs, InferValidatedFlags)
  ↓
User handler receives fully typed args/flags with schema output types
```

### Validation Error Handling

- **Parse errors** (core `parser.ts`): Unknown flags, type coercion failures → `CrustError("PARSE")`
- **Validation errors** (middleware): Schema failures → `CrustError("VALIDATION")` with `details.issues` (normalized)
- **Definition errors** (arg/flag/field): Invalid schemas, missing type inference → `CrustError("DEFINITION")`

### Inheritance & Defaults

- **Flag inheritance**: marked with `inherit: true`; merged via `EffectiveFlags<Inherited, Local>`
- **Field defaults**: schema-derived (runtime populated) or explicit `opts.default` (narrows type)
- **Merge semantics** (`applyFieldDefaults`): persisted > schema default > field omitted

## Start Here

1. **`packages/validate/src/schema.ts`** (arg/flag DSL) — Entry point for users; shows how Standard Schema is wrapped and branded
2. **`packages/validate/src/middleware.ts`** (validation runner) — Core validation loop; read to understand schema execution and error collection
3. **`packages/validate/src/command.test.ts`** (full suite) — Comprehensive test coverage; demonstrates Zod and Effect integration, vendor-specific behavior, type narrowing, inheritance, async refinements
4. **`packages/store/src/field.ts`** (store field factory) — Parallel to arg/flag; shows field-specific default narrowing and transform handling
5. **`packages/utils/src/schema/introspect.ts`** (vendor dispatch) — Central introspection logic; understand to extend support for new vendors

## Supervisor Coordination

No blocking issues identified. Schema-backed validation is architecturally sound and tested comprehensively across Zod and Effect. Files are well-scoped and ready for targeted changes.

## Test Commands

All tests use Bun's native test runner (`bun:test`):

```bash
# Run all tests across workspace
bun run test

# Run tests in a single package
bun run test --filter='./packages/validate'
bun run test --filter='./packages/store'
bun run test --filter='./packages/core'

# Run specific test file
bun run test -- packages/validate/src/command.test.ts

# Type check all packages
bun run check:types

# Lint & format
bun run check
```

## Current Behavior Summary

- **arg()** and **flag()** accept any Standard Schema v1; auto-infer CLI type/required/description via vendor dispatch
- **commandValidator()** wraps user handler; executes schemas post-parse, collects issues, throws or forwards to handler
- **field()** mirrors arg/flag semantics but returns store-compatible FieldDef with async validate()
- **Defaults**: schema-derived at runtime (don't narrow type) or explicit opts (narrow type)
- **Vendors**: Zod natively; Effect via `Schema.standardSchemaV1(...)` wrapper; others return `{}` (user supplies opts)
- **Error handling**: Separated into PARSE (core), VALIDATION (schema), DEFINITION (DSL)
- **Async support**: Both sync and async validators supported transparently

## Files Likely to Need Changes

1. **packages/validate/src/schema.ts** — If adding new metadata fields to arg/flag DSL
2. **packages/validate/src/middleware.ts** — If changing validation loop logic or error collection
3. **packages/validate/src/schema-types.ts** — If changing branded def types or type inference
4. **packages/store/src/field.ts** — If changing field factory behavior or transform handling
5. **packages/utils/src/schema/introspect.ts** — If adding vendor adapters or changing inference logic
6. **packages/utils/src/schema/types.ts** — If changing StandardSchema type aliases
7. **Test files** — co-located `*.test.ts` files alongside changed source

## Constraints & Risks

- **Standard Schema v1 spec**: All vendors must implement `schema["~standard"].validate(value)` returning `{ value } | { issues }` (sync or async)
- **Type narrowing fragility**: Type inference depends on schema's Input/Output being fully narrowable; wide types (broad `string`) fall back to `ValueType` union
- **Vendor dispatch fallback**: Unknown vendors return `{}` from `inferOptions()`; users must supply CLI metadata explicitly
- **Async-safe validation**: All schema validators are awaited; no blocking during validation phase
- **Transformation read-stability**: Schemas that transform types must not produce values that fail re-validation on read (enforced by store)
- **Symbol-based brand**: `[VALIDATED_SCHEMA]` is a unique symbol, survives spread/freeze; critical to validation pipeline
