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

## Validation

Run the existing docs gates from the repository root (also run by CI for docs and package changes):

```sh
bun run check:types --filter=./apps/docs
bun run lint apps/docs
bun run format apps/docs
bun run --cwd apps/docs test
bun run build:docs
```
