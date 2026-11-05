---
"@crustjs/core": patch
---

Extension commands are typed like commands added with `.add()`, as the docs describe:

- Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when an app registers 45 or more Extension commands, whether one Extension `.add()`s them, one `.extend()` call passes many Extensions, or up to about 200 `.extend()` calls are chained.
- Fix the same `TS2589` for one `.add()` call with about 50 or more literal commands followed by one whose name is only known at runtime.
- A conditionally chosen Extension (`.extend(cond ? a : b)`) or an Extension with a conditional commands array no longer rejects every `run()` path. Like any Extension whose command names are only known at runtime, it leaves paths to runtime checks and makes `run()` results `unknown`, because it may re-register an earlier Extension's id.
