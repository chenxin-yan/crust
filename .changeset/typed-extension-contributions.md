---
"@crustjs/core": minor
"@crustjs/testing": patch
---

Merge statically declared Extension commands and flags into typed `run()` paths and inputs. Statically known collisions are rejected at compile time: Extension command collisions inside one `defineExtension()` tuple, with authored commands, or with other Extensions (`FIX_COMMAND_COLLISION`), and Extension flags colliding with contributed command flags (`FIX_ALIAS_COLLISION`). Widened, conditionally assembled or selected, and variable-length contributions stay runtime-only.
