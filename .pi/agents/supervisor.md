---
name: supervisor
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Supervisor Guidance

  This file is COMPOSED with the base supervisor prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Supervisor identity and standing orders
  - Recovery action classification and autonomy levels
  - Audit trail format and rules
  - Batch monitoring, failure handling, operator communication
  - Orchestrator tool reference (orch_status, orch_pause, etc.)
  - Startup checklist and operational knowledge

  Add project-specific supervisor rules below. Common examples:
  - Run linter before integration ("always run `npm run lint` after merge")
  - CI dashboard URL for failure triage
  - PR template or label conventions
  - Project-specific recovery procedures
  - Team notification preferences (Slack, etc.)
  - Custom health check commands

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->

## Crust Supervisor Rules

### Verification gate

The authoritative health check for this project is:

```sh
bun run check && bun run check:types && bun run test
```

Run this in the orch branch worktree before recommending `/orch-integrate`,
and after any manual recovery merge. If any of the three fails, do not
declare a wave (or batch) successful — escalate.

### Default integration mode

- **Use `--mode pr`** for `/orch-integrate` by default. The `main` branch is
  currently unprotected, but Crust is a published library and changes deserve
  human review through a GitHub PR before they hit `main`.
- If the operator explicitly asks for fast-forward or merge, respect that.
- Polite reminder for the operator on first integration: enabling branch
  protection on `main` (require PRs, require status checks) is a low-effort
  win that pairs well with Taskplane's PR-first workflow.

### GitHub awareness

- `gh` CLI is configured. When listing potential work for the operator,
  include open issues:
  ```sh
  gh issue list --state open --limit 20
  ```
- Several issues describe new packages or migrations (e.g., `@crustjs/log`,
  `@crustjs/test`, `@crustjs/env`, style → bun color migration). These are
  good candidates to convert into Taskplane tasks via the `create-taskplane-task`
  skill.

### Recovery quirks specific to Crust

- **Turbo cache surprises:** if a verification command appears to pass
  instantly, suspect a stale `.turbo/` cache. Re-run with
  `bun run test --force` (or `turbo run test --force`) to confirm.
- **`bun.lock` drift:** lane branches occasionally diverge on `bun.lock`. If
  a merge fails on the lockfile, the right move is `bun install` in the
  merge worktree after resolving any `package.json` conflicts.
- **Changeset files** are one-per-PR by convention. Two lanes adding
  different changeset files is fine (no conflict); two lanes adding the
  *same* changeset file should be flagged.

### Things never to touch

- `CHANGELOG.md` (any package) — managed by Changesets.
- `.changeset/config.json` — release configuration, owned by maintainer.
- Version fields in any `package.json` — bumped by `bun run packages:version` only.
