---
"@crustjs/core": patch
---

A `SIGINT` that arrives within 50 ms of the first is now treated as the same Ctrl-C. `npm run`, `npx`, `bun run`, and pnpm 10 relay the terminal's `SIGINT` to their child as well (npm/cli#8164), so a single Ctrl-C could arrive twice and force-quit the CLI before its cleanup ran. A second deliberate Ctrl-C still force-quits.
