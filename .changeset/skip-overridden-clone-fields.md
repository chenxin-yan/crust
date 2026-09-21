---
"@crustjs/core": patch
---

Builder methods (`.flags()`, `.args()`, `.use()`, `.provide()`, `.action()`, `.extend()`, `.add()`, `.command()`) now copy only the command-node containers they change and share the rest with the source builder, so building a CLI allocates less. Builders stay immutable: the source builder is never affected by derived ones.
