# Crust Docs

Documentation site for the Crust CLI framework, built with [Fumadocs](https://fumadocs.vercel.app) + TanStack Start.

```bash
bun run dev
```

## Source-derived references

- Use `<auto-type-table path="…" name="…" />` for object shapes, pointing from the MDX page to the owning declaration. Do not commit generator caches or `.source` output.
- Property tables can omit readonly modifiers, unions, overloads and generic constraints. Label signature sketches as summaries and link owning source files for exact contracts. Source links track `main`; installed declarations describe released versions.
- Keep behavior, computed defaults and rationale authored; `@default` is documentation, not runtime verification. Label curated export summaries as curated.
- Keep complete, high-risk examples in `examples/` and embed them with `<include lang="ts">…</include>` so the docs TypeScript project checks them. Partial sketches can remain MDX fences.

## CLI parity and validation

`check:references` compares authored build/publish flags, runtimes and targets in `guide/build.mdx`, and scaffold options in `modules/create-crust.mdx`, against source snapshots/constants. Keep named headings, pipe tables and source order; the first four flag columns are spellings, type, choices and declared default (`—` means none). Effective build defaults and scaffold prompt defaults remain separate authored prose, outside mechanical parity.

The command builds `create-crust` and its dependencies first: its `CRUST_*` globals require build-time substitution. The built CLI snapshot subprocess exits before actions, so no scaffolding, installation or publishing runs. Build/publish checks import inert source definitions; those cross-workspace imports explain the `packages/crust/src/**` input in the docs Turbo typecheck cache.

Run the existing docs gates from the repository root (also run by CI for docs and package changes):

```sh
bun run --cwd apps/docs check:references
bun run check:types --filter=./apps/docs
bun run lint apps/docs
bun run format apps/docs
bun run build:docs
```
