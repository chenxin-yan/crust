---
"@crustjs/extensions": minor
---

**Breaking:** `confirm()` is renamed `confirmation()` and `input()` is renamed `jsonInput()`. `@crustjs/prompts` exports questions named `confirm()` and `input()`, so a file that needed both failed to compile with a duplicate identifier.

- Replace `.extend(confirm())` with `.extend(confirmation())` and `.use(confirm)` with `.use(confirmation)`. The Context keeps its name, so actions still `await ctx.confirm`. Its Extension id is now `crust:confirmation`.
- Replace `.extend(input())` with `.extend(jsonInput())`. The flag is still `--input`. Its Extension id is now `crust:json-input`.
- `confirmation()` takes no options. Its `--yes` flag gains the short `-y`, so a command that uses it can no longer give `-y` to a flag of its own.

See [Confirmation](https://crustjs.com/docs/modules/extensions/confirmation) and [JSON Input](https://crustjs.com/docs/modules/extensions/json-input).
