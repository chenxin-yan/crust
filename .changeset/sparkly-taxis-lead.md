---
"@crustjs/crust": patch
---

Reject crust.include and Extension artifact directories that collide with `bin` or each other only by letter case, since they alias on case-insensitive file systems.
