---
"@crustjs/utils": patch
---

Clean up timed-out subprocess trees instead of only their direct child. POSIX cleanup reaches descendants in the process group; Windows cleanup targets live process trees.
