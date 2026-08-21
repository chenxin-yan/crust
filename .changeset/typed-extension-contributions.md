---
"@crustjs/core": minor
"@crustjs/testing": patch
---

Merge statically declared Extension commands and flags into typed `run()` paths and inputs. Statically known Extension command collisions with authored commands or other Extensions are rejected at compile time (`FIX_COMMAND_COLLISION`); widened or conditionally assembled contributions stay runtime-only.
