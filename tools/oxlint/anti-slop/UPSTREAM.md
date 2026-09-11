# Upstream provenance

Vendored from <https://github.com/dmmulroy/anti-slop> (`src/` → this directory). The
upstream project is designed to be vendored and forked; this copy is owned here and
diverges deliberately.

|                            | Revision                        |
| -------------------------- | ------------------------------- |
| Base (original copy, #308) | `6d53855` (2026-08-18)          |
| Reviewed through           | `c44ef22` (2026-09-10, v0.1.2+) |

## Adopted from `c44ef22`

- `rules/no-array-filter-map` + `shared/array-method`
- `rules/no-reduce-accumulator-copy` (paired with native `oxc/no-accumulating-spread`)
- `rules/no-widen-then-assert`

## Local deviations (keep on future updates)

- `no-module-mocking`: also detects Bun `mock.module` (`bun:test`) and Jest `setMock`;
  resolves namespace imports.
- `no-unknown-parameters`: local `allowInBoundaryFunctions` option.
- Helpers split into `shared/{parameters,scope,type-aliases}.ts`; upstream later grew an
  identical `shared/scope.ts` and a `shared/type-alias-resolution.ts`.
- Formatted with repo `oxfmt` (tabs); linted by the repo config including these rules,
  so upstream's `x as unknown as T` double-casts are rewritten.
- Tests run under Node's test runner (`bun test` cannot host Oxlint `RuleTester`).

## Intentionally not vendored

- Upstream's 2026-08-31 semantic fixes to the ten original rules: measured zero
  enforcement change on this repo; not worth a three-way merge into customized files.
- `require-readable-spacing` (+ vendored eslint-stylistic): formatting is `oxfmt`'s job.
- `no-shape-in-symbol-names`: `CommandShape`/`CommandShapeAt`/`_types.shape` are public,
  documented API.
- `no-conditional-empty-object-spread`: `...(cond ? { k } : {})` is the accepted idiom here.
- `no-reflect-apply` / `no-reflect-get`: covered by `eslint/no-restricted-properties`.
- `effect/*`: no Effect dependency.

## Updating

```bash
git clone https://github.com/dmmulroy/anti-slop .agent-sources/anti-slop   # git-excluded
git -C .agent-sources/anti-slop diff c44ef22..HEAD -- src/
```

Port reviewed changes by hand; do not overwrite this directory. Bump "Reviewed through"
and extend the lists above.
