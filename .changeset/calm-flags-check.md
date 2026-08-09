---
"@crustjs/core": minor
---

Cache accumulated flag spellings in the trailing, defaulted `Sp` generic parameter on `Crust` and `CommandDefinitionBuilder`, reducing type-check work for repeated `.flags()` calls while preserving existing generic annotations. Known spellings now remain collision-checked after an intervening widened flag definition.
