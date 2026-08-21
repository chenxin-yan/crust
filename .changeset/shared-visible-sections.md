---
"@crustjs/core": patch
"@crustjs/man": patch
"@crustjs/skills": patch
---

Add a shared `visibleSectionsFor()` helper for audience-filtered traversal of visible command trees, and use it in the man-page renderer. Derive generated skill section content from Core's `CommandSection` type.
