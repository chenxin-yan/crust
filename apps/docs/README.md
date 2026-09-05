# Crust Docs

Documentation site for the Crust CLI framework, built with [Fumadocs](https://fumadocs.vercel.app) + TanStack Start.

```bash
bun run dev
```

## Source-derived reference conventions

- Use `<auto-type-table path="…" name="…" />` for exported object options and simple data shapes. Paths are relative to the MDX page and should point directly to the declaration, not a re-export. The existing Fumadocs generator reads TypeScript and property JSDoc during compilation; do not commit its cache or `.source` output.
- Property tables are not exact declarations: readonly modifiers, unions, overloads and generic constraints can be lost. Keep readable signature sketches labeled as summaries and link the owning source file (without fragile line numbers) for exact contracts. Do not feed literal unions or callable interfaces into a property table just to claim coverage.
- Keep behavior, computed defaults, examples and rationale authored. `@default` is documentation, not a runtime assertion. Source links track `main`; installed package declarations are authoritative for a particular released version.
- Move complete, high-risk TypeScript examples into `examples/` and use the existing `<include lang="ts">…</include>` mechanism. The docs TypeScript project already checks them. Use named `//#region` markers only for excerpts; intentionally partial examples and signature sketches remain MDX fences.
- Label curated export summaries as curated. Public package barrels and supported subpaths define the boundary, not every exported symbol inside a source file.

## CLI parity checks

The build/publish tables in `guide/build.mdx` and scaffold option tables in `modules/create-crust.mdx` and `packages/create-crust/README.md` remain **authored, not generated**. Update their mechanical columns when command definitions change:

1. Keep the first four columns in order: flag spellings, type (with ` (repeatable)` when applicable), choices, declared default. Preserve definition order and all spellings, including negations. Use comma-separated backticked values and JSON spelling for declared defaults; `—` means none is declared.
2. Keep effective build defaults and scaffold prompt defaults in authored prose, separate from declared defaults. The checks do not establish runtime/prompt behavior or description accuracy.
3. Keep runtime names and canonical target rows in source order. Platform explanations remain authored.
4. Run `bun run --cwd apps/docs check:references` from the repository root. This builds `create-crust` and its dependencies before testing, so a clean checkout cannot rely on missing/stale CLI output. Build/publish checks import inert definitions; scaffold checks use the existing first-party snapshot subprocess protocol, not the executable module or its action. No scaffold, installation or publishing action runs.

The docs-local Turbo `check:types` inputs include `packages/crust/src/**` because these checks import build/publish source definitions directly, outside the docs workspace dependency graph. Keep those inputs aligned with any new cross-workspace source imports.

The checker reads the first Markdown table under each named heading; keep these headings and ordinary pipe tables stable, or update the test with the page. Table padding is ignored. Adding, removing, duplicating or changing an option, spelling, type, choice, declared default, runtime or target fails parity. Descriptions and computed/prompt defaults intentionally remain outside mechanical parity.

## Validation

From the repository root:

```sh
bun run --cwd apps/docs check:references
bun run check:types --filter=./apps/docs
bun run lint apps/docs
bun run format apps/docs
bun run build:docs
bun run --cwd apps/docs check:output
```

`check:output` starts the existing Vite preview on `127.0.0.1:4317` (keep that port free), checks included examples and generated property data through processed Markdown, the LLM routes and search, then stops preview. Run it after a fresh docs build; it checks compiled local output, not the deployed site or browser interactions.

CI Docs runs these checks for `apps/docs/**` and `packages/**` changes. The existing docs build resolves type-table markers and includes into the same Fumadocs collection used by the website, search and processed Markdown/LLM routes; there is no parallel reference registry or generator.

The [source-of-truth audit](../../docs/research/documentation-source-of-truth-audit.md) is a historical baseline, not current coverage counts or proof of exhaustive semantic parity.
