---
"@crustjs/utils": minor
"@crustjs/extensions": patch
---

`@crustjs/utils/terminal` exports `isCI(env = process.env)`, the rule `confirm()` and `updateNotifier()` use: `CI` counts as set unless it is unset, empty, `0`, or `false` in any letter case. `@crustjs/extensions` now imports it instead of keeping its own copy; behavior is unchanged.
