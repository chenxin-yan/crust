---
"@crustjs/core": patch
---

Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when about 50 or more chained `.extend()` calls register Extensions that add flags, including Extensions whose commands have subcommands.
