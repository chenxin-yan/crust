---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Rename the typed invocation APIs `CommandShape` and `CommandShapeAt` to `CommandContract` and `CommandContractAtPath`, and rename the invalid-alias diagnostic key from `FIX_ALIAS_SHAPE` to `FIX_INVALID_ALIAS`. `@crustjs/testing` now requires a compatible `@crustjs/core` `^0.1.0` because its declarations use the renamed contract types.
