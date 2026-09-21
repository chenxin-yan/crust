---
"@crustjs/core": patch
---

Flag parsing no longer allocates and discards a `util.parseArgs` option descriptor for every short flag spelling; the accepted spellings and parsed values are unchanged.
