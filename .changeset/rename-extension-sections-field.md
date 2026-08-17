---
"@crustjs/core": minor
---

Rename the `defineExtension` `sections` field to `commandSections`. The field is a contribution point that appends documentation sections to target commands' `meta.sections`; the new name reads as "sections attached to commands" rather than sections describing the Extension itself. Command-side `meta.sections` is unchanged.
