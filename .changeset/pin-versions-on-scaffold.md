---
"create-crust": patch
"@crustjs/create": patch
---

`create-crust` now resolves and pins `@crustjs/*` package versions at scaffold time instead of shipping `"latest"` in the generated `package.json`.

- Removes hardcoded `"latest"` entries from runtime and binary distribution templates.
- Adds a new `add` post-scaffold step to `@crustjs/create` that invokes the detected package manager's `add` command so resolved caret ranges (e.g. `^1.2.3`) are written into the user's `package.json`.
- When `--no-install` is passed, `@crustjs/*` packages are not added to `package.json` — users must add them manually.
