---
"@crustjs/core": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/skills": patch
---

Add a shared `visibleSectionsFor()` helper for audience-filtered traversal of visible command trees, and use it across the man-page and skills renderers. Derive generated skill section content from Core's `CommandSection` type.
