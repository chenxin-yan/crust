---
"@crustjs/core": minor
---

Context construction is now `requires`-scoped, not path-scoped. A command added with `defineCommand` constructs only the Contexts it provides itself plus the transitive `requires` closure of its declared requirements; inherited Contexts it does not require are never constructed (matching the recipe's `ctx` typing, which never exposed them). The root command's own action still constructs everything provided on it. Providing Contexts once at the root is now free for commands that don't require them.
