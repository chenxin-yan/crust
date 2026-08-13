---
"@crustjs/core": minor
---

Replace the eight generic parameters on `Crust` and `CommandDefinitionBuilder` with six by unifying local and Context-owned flags into one `Flags` parameter and removing the redundant effective-flags cache. This is a breaking change for explicit positional generic annotations; prefer inference or migrate to `Crust<Flags, A, Ctx, Sibs, Sp, H>`.
