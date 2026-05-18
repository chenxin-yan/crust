# TP-011 — Status

## Current step

Step 1 complete — utils primitive module added and verified.

## Step log

- Step 0: The authoritative PROMPT path provided in the task is absent in this checkout, so implementation is proceeding from the user's task text plus the three supplied context-builder files. Verified `packages/utils/` exists and `apps/docs/content/docs/modules/utils.mdx` exists. Baseline package tests were already green in the supplied validation context.
- Step 1: Added `packages/utils/src/primitive.ts` with `BaseValueType`, distributive `ResolvePrimitive`, `tryCoerceNumber`, and exact `coerceBooleanString`; added `primitive.test.ts`; exported primitives from utils barrel; updated `packages/utils/README.md`.

## Discoveries

- `taskplane-tasks/TP-011-consolidate-type-primitives-to-utils/PROMPT.md` was not present in this repository checkout.
- `packages/core/package.json` has no `dependencies` block; adding `@crustjs/utils` will contradict the core README's zero-runtime-dependencies tagline, so that README line must be updated.
- `packages/store/package.json` already depends on `@crustjs/utils`; do not re-add it.
- `packages/store/src/field.ts` uses an inline primitive union in `FieldOptions.type`; no standalone `ValueType` alias exists there.
- `apps/docs/content/docs/modules/utils.mdx` exists and must be updated in Step 5.

## Verification

- Step 0: Context files read; package and docs surfaces inspected.
- Step 1: `cd packages/utils && bun test` — pass (16 tests).
