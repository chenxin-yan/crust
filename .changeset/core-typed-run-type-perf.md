---
"@crustjs/core": patch
---

Speed up type-checking of typed `app.run(path, input)` calls and fix `TS2590: Expression produces a union type that is too complex to represent` from `app.at()`/`app.run()` on apps with several hundred command spellings. One literal `run()` call on a 100-command app now costs about 0.3M type instantiations instead of 5.6M. If you pass explicit type arguments to `app.run(path, input)`, the second type parameter is now the selected command shape; the input type moved to third. Calls that pass only the path type argument (`app.run<readonly ["build"]>(...)`) are unchanged.
