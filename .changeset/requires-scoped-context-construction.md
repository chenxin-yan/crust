---
"@crustjs/core": minor
---

Context construction is now `requires`-scoped, not path-scoped. A command added with `defineCommand` constructs only the Contexts it provides itself plus the transitive `requires` closure of its declared requirements and of those self-provided Contexts; inherited Contexts outside that closure are never constructed (matching the recipe's `ctx` typing, which never exposed them). The root command's own action still constructs everything provided on it. Providing Contexts once at the root is now free for commands that don't require them.

If a command relied on an inherited Context constructing without declaring it (for example for setup side effects), declare it in `requires`.
