---
"@crustjs/store": patch
---

Store files end with a newline, and a mutation keeps the order of the keys already in the file, adding new keys after them. A `patch()` used to rewrite the file in the order of the field definitions, and the file had no final newline, so a file someone edited by hand changed shape on every write.
