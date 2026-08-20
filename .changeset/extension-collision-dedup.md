---
"@crustjs/core": patch
---

Reject statically known Extension command collisions and keep only the last registration for duplicate Extension ids. This is a patch because both changes tighten invalid or accidentally duplicated registrations without adding a new API.
