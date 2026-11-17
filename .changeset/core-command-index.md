---
"@crustjs/core": minor
---

`@crustjs/core/tooling` exports `createCommandIndex(commands)`, a search index over command snapshots: `index.search(query, limit)` returns the canonical paths that best match the query's words, best first. Command names and aliases weigh most, then descriptions, then argument and flag names and descriptions; words match without case and split at camelCase, as written first, then in their singular form, then by prefix. A command scores the same whatever else is indexed. `search()` in `@crustjs/extensions` and MCP's progressive discovery rank with it.
