---
"@crustjs/crust": patch
---

Fail and clean up hung Command Snapshot preparation at the build deadline, including entries that ignore SIGTERM and descendants holding stderr. Interrupting or exiting the build also stops the entry.
