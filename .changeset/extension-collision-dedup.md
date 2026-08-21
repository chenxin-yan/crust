---
"@crustjs/core": patch
---

Reject statically known Extension command collisions — against the application, earlier Extensions, and within one Extension's own commands — and keep only the last registration for duplicate Extension ids. This is a patch because both changes tighten invalid or accidentally duplicated registrations without adding a new API.
