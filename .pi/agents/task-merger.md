---
name: task-merger
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Merger Guidance

  This file is COMPOSED with the base task-merger prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Branch merge workflow (fast-forward, 3-way, conflict resolution)
  - Post-merge verification command execution
  - Result file JSON format and writing conventions

  Add project-specific merge rules below. Common examples:
  - Post-merge verification commands (build, lint, test)
  - Conflict resolution preferences
  - Protected files that should never be auto-merged

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->

## Crust Merge Verification

This project is a Bun-native, TypeScript-first Turborepo monorepo. Verification
after merge is **non-negotiable** — Biome, TypeScript, and tests must all pass
before reporting SUCCESS.

### Required post-merge verification (in order)

```sh
bun install --frozen-lockfile      # Ensure lockfile matches package.json
bun run check                      # Biome: lint + format
bun run check:types                # TypeScript across the workspace
bun run test                       # Full test suite (turbo, cached)
```

If any step fails, the merge is FAILURE. Do **not** report SUCCESS just
because the git merge itself was conflict-free.

### Conflict resolution preferences

- **`bun.lock`** — if both branches modified it, regenerate with
  `bun install` after merging `package.json` files. Don't try to hand-merge
  the lockfile.
- **`.changeset/*.md`** — these are intentionally one-per-PR; if two lanes
  added different changesets, keep both files (they don't actually conflict).
  If they touched the *same* changeset file, merge the entries (typically
  picking the union of bumped packages).
- **`CHANGELOG.md`** files — these should not appear in lane diffs (they're
  protected). If they do, prefer the version on the merge target (orch branch)
  unless the conflict is purely additive.
- **Source files** — examine both sides, prefer the version owned by the task
  declared in PROMPT.md `File Scope`. If the conflict is structural and you're
  unsure, mark FAILURE with a clear note rather than guessing.
- **`turbo.json` / `biome.json`** — pipeline/format config. Conflicts here are
  rare and usually deliberate; prefer the union of changes when both sides
  added new entries.

### Things never to merge automatically

- Manual edits to any `CHANGELOG.md` file. If a lane modified a changelog,
  flag the merge as FAILURE — that file is owned by Changesets, not workers.
- Commits that bump versions in `package.json` files (release workflow only).
- Lockfile regenerations that didn't accompany a real `package.json` change.
