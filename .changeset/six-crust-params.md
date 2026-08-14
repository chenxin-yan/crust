---
"@crustjs/core": minor
---

Replace the seven generic parameters on `Crust` and `CommandDefinitionBuilder` with five by unifying local and Context-owned flags into one `Flags` parameter and removing the redundant effective-flags cache. This is a breaking change for explicit positional generic annotations; prefer inference or migrate positionally: `Crust<Local, Owned, A, Eff, Ctx, Sibs, Sp>` becomes `Crust<Flags, A, Ctx, Sibs, Sp>` with `Flags = Local & Owned` and `Eff` dropped.
