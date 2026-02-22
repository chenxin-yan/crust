# Roadmap Data

This directory contains the data files that power the `/roadmap` page.

## Files

- **`config.json`** — Human-editable board configuration (columns, module map, cutoff settings).
- **`issues.generated.json`** — Machine-generated snapshot of GitHub issues. Do not edit manually; it is overwritten by the sync script.

## How It Works

1. GitHub Issues labeled `roadmap` are the source of truth.
2. At build time, `scripts/syncRoadmapIssues.ts` fetches these issues, validates labels, and writes `issues.generated.json`.
3. The roadmap page reads both files and renders a Kanban board.

## Label Conventions

Every roadmap issue **must** have:

- `roadmap` — includes the issue on the board.
- Exactly one **status** label (for open issues):
  - `status:planned`
  - `status:in-progress`
  - `status:blocked`
- Closed issues are automatically shown in the **Done** column (no label needed).

Optionally, add one or more **module** labels:

- `module:core`, `module:plugins`, `module:crust`, `module:create`
- `module:validate`, `module:prompt`, `module:style`, `module:test`
- `module:render`, `module:store`, `module:log`

## Running the Sync

```bash
# From apps/docs/
bun run roadmap:sync

# With GitHub token for higher rate limits
GITHUB_TOKEN=ghp_xxx bun run roadmap:sync
```

The sync script will fail if:

- An open issue is missing a status label.
- An open issue has multiple status labels.
- An issue has an unknown `module:*` label.

## Adding a New Module

1. Add the module slug to `config.json` → `moduleMap`.
2. Create the corresponding `module:slug` label in GitHub.
3. Update the issue template at `.github/ISSUE_TEMPLATE/roadmap-item.yml`.
