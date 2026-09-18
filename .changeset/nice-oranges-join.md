---
"@crustjs/crust": patch
---

Validate package identity before clearing build staging and preflight publish metadata, canonical containment, and directory uniqueness before invoking npm. Reject unexpected artifact links and nonregular files, case-insensitive cross-entry collisions, and malformed or legacy Build Reports. Core, tooling, and build-hook Extensions must use the coordinated pure-return build API; no legacy writer compatibility is added.
