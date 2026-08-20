---
"@crustjs/core": minor
---

Remove type-expressible runtime command-definition validation in favor of TypeScript compile-time checks. Retain runtime validation for argv input, dynamic Context and documentation behavior, reserved dynamic Extension injection, and command-recipe behavior that TypeScript cannot express.
