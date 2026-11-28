---
"@crustjs/prompts": minor
---

`prompts()` asks after every Extension's `preRun` check passed, whatever the `.extend()` order, so a login check listed after it refuses the run before anything is asked. A `preRun` check therefore never sees an answer; validation and the action do.
