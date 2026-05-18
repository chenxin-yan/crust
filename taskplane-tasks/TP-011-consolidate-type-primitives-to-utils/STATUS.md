# TP-011 — Status

## Current step

Step 4 complete — full verification green and changesets added.

## Step log

- Step 0: The authoritative PROMPT path provided in the task is absent in this checkout, so implementation is proceeding from the user's task text plus the three supplied context-builder files. Verified `packages/utils/` exists and `apps/docs/content/docs/modules/utils.mdx` exists. Baseline package tests were already green in the supplied validation context.
- Step 1: Added `packages/utils/src/primitive.ts` with `BaseValueType`, distributive `ResolvePrimitive`, `tryCoerceNumber`, and exact `coerceBooleanString`; added `primitive.test.ts`; exported primitives from utils barrel; updated `packages/utils/README.md`.
- Step 2: Migrated `packages/core/src/types.ts` and `packages/core/src/parser.ts` to `@crustjs/utils`. Added core runtime dependency on `@crustjs/utils` and updated the core README tagline away from zero runtime dependencies.
- Step 3: Migrated `packages/store/src/types.ts`, `packages/store/src/store.ts`, and `packages/store/src/field.ts` to shared utils primitives. Preserved store numeric fallback with `tryCoerceNumber(value) ?? value`.
- Step 4: Ran final verification ladder and added three changesets for `@crustjs/utils` (minor), `@crustjs/core` (patch), and `@crustjs/store` (patch).

## Discoveries

- `taskplane-tasks/TP-011-consolidate-type-primitives-to-utils/PROMPT.md` was not present in this repository checkout.
- `packages/core/package.json` has no `dependencies` block; adding `@crustjs/utils` will contradict the core README's zero-runtime-dependencies tagline, so that README line must be updated.
- `packages/store/package.json` already depends on `@crustjs/utils`; do not re-add it.
- `packages/store/src/field.ts` uses an inline primitive union in `FieldOptions.type`; no standalone `ValueType` alias exists there.
- `apps/docs/content/docs/modules/utils.mdx` exists and must be updated in Step 5.

## Verification

- Step 0: Context files read; package and docs surfaces inspected.
- Step 1: `cd packages/utils && bun test` — pass (16 tests).
- Step 2: `cd packages/utils && bun run build && cd ../core && bun test` — pass (477 tests). The first core test attempt failed because `@crustjs/utils` dist was stale; building utils resolved it.
- Step 3: `cd packages/store && bun test` — pass (244 tests).
- Step 4: `bun run check && bun run check:types && bun run test && bun run build` — pass. First attempt found Biome formatting in `primitive.test.ts`; fixed and reran successfully.
- Step 4: `rg 'import.*ValueType.*from "@crustjs/(core|store)"|ValueType.*from "@crustjs/(core|store)"' packages apps || true` — no output.
