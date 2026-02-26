---
"@crustjs/create": patch
"create-crust": patch
---

Add `isInGitRepo` utility to detect if a directory is inside an existing git repository.

Updated `create-crust` to skip the "Initialize a git repository?" prompt when scaffolding inside an existing repo, preventing accidental nested `.git` directories.
