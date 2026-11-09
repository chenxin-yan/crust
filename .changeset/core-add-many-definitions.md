---
"@crustjs/core": patch
---

Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `app.add(...)` or Extension `.add(...)` call registers 44 or more command definitions. The error names the `FIX_*` key and its text instead of the argument position. `.add<ExplicitTuple>(...)` on a builder union (`condition ? app.add(a) : app`) no longer reports a duplicate command name at compile time; `.add()` still throws for it at runtime.
