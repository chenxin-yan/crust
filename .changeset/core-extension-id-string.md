---
"@crustjs/core": minor
"@crustjs/mcp": minor
---

**Breaking:** an Extension's id is the string passed to `defineExtension()`. `defineExtensionId()` and the `ExtensionId` type are removed.

- Replace `defineExtension(defineExtensionId("acme:preview"))` with `defineExtension("acme:preview")`, and drop the `defineExtensionId` import. The literal id is still inferred, so a later registration of the same id still removes the earlier one's flags from the types. A blank or untrimmed id throws the same `DEFINITION` error (`empty-id`), now from `defineExtension()`.
- Where a type said `ExtensionId`, it says `string`: `outcome.by`, `command.extension` and `flag.extension` in snapshots, the build report's ids, and section audiences.
- `sectionsFor()` and `visibleSectionsFor()` from `@crustjs/core/tooling` accept an Extension as well as an id, as `only` and `except` do. An Extension can name itself in its own hook: `defineExtension("acme:web-docs").build(({ snapshot }) => visibleSectionsFor(snapshot, webDocs))`.
- Refer to an Extension by the Extension itself, not a separate id variable: `only: [help]`, `outcome.by === help.id`.
- `@crustjs/mcp`: **Breaking:** the `MCP` id constant is no longer exported; use `mcp.id`.

See [Extensions](https://crustjs.com/docs/guide/extensions#ids-and-builders).
