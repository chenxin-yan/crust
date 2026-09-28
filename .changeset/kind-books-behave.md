---
"@crustjs/store": patch
---

Treat store keys named like Object.prototype members (constructor, toString, __proto__) as ordinary own fields, so defaults apply and unknown keys survive patch round trips.
