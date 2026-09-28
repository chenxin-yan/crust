---
"@crustjs/effect": patch
---

Skip Layers shadowed by a same-name descendant Context in handler(), so a descendant plain Context stays lazy and no longer fails the action
