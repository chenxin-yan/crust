---
"@crustjs/utils": patch
---

Clean up timed-out subprocess trees instead of only their direct child. POSIX cleanup reaches descendants in the process group; Windows cleanup targets live process trees.

Preserve direct-child termination when POSIX process-group signaling fails, including under Deno with executable-scoped run permission. Full group cleanup requires unrestricted `--allow-run`; denied cleanup is still reported after terminating the child.
