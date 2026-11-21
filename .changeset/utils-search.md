---
"@crustjs/utils": minor
---

`@crustjs/utils/search` exports `createSearchIndex(items)`, the word ranking behind `search()` in `@crustjs/extensions` and `search_tools` in `@crustjs/mcp`. Each item gives its texts in three weight classes (`names`, `descriptions`, `details`); the returned function takes a query and a limit and returns the indexes of the best matches, best first, ties in item order, and none for a limit below 1. A word counts more the fewer items it matches, and a match counts more in a short field than in a long one. `commandSearchItem(path, command)` builds the item of a command from its path, name, aliases, description, arguments, and the flags no Extension declares.
