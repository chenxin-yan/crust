## Tests

- `bun:test`: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- Unit tests: co-located (`src/foo.test.ts` beside `src/foo.ts`)
- Integration/smoke tests: `tests/`

## Documentation

Update relevant docs/code comments in the same change as the code. Stale docs = bug.

Doc surfaces:

- `apps/docs/content/docs/guide/*.mdx` — conceptual guides
- `apps/docs/content/docs/modules/*.mdx` — per-package reference
- `apps/docs/content/docs/api/*.mdx` — public API reference
- `packages/<pkg>/README.md` — npm landing page

Before submitting:

- Examples in changed docs compile against the new API
- Cross-links resolve; `meta.json` updated if pages added/removed/reordered
- Package README and `modules/<pkg>.mdx` agree on install, exports, quick example

## Changesets

Do not edit `CHANGELOG.md` manually. Run `bunx changeset` to record user-visible changes; release tooling consumes them.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`chenxin-yan/crust`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
