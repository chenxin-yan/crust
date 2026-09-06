## Tests

- `bun:test`: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- Unit tests: co-located (`src/foo.test.ts` beside `src/foo.ts`)
- Compile-only type tests: co-located `src/foo.test-d.ts`; enforced by `bun run check:types`, not discovered by `bun test`. Must not import `bun:test` or use Bun globals (CI portable-runtime guard).
- Integration/smoke tests: package-local `packages/<pkg>/tests/`

## Documentation

Update relevant docs/code comments in the same change as the code. Stale docs = bug.

Doc surfaces:

- `apps/docs/content/docs/guide/*.mdx` — conceptual guides
- `apps/docs/content/docs/modules/*.mdx` — per-package reference
- `apps/docs/content/docs/api/*.mdx` — public API reference

Before submitting:

- Examples in changed docs compile against the new API
- Cross-links resolve; `meta.json` updated if pages added/removed/reordered
- Package README and `modules/<pkg>.mdx` agree on install, exports, quick example

## Changesets

Do not edit `CHANGELOG.md` manually. Run `bunx changeset` to record user-visible changes; release tooling consumes them. Skip changesets for changes with no end-user behavior impact (internal refactors, tests, docs, CI, tooling).

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`chenxin-yan/crust`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Create `CONTEXT.md` and `docs/adr/` at the repo root lazily when domain terms or architecture decisions need recording. See `docs/agents/domain.md`.
