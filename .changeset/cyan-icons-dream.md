---
"@crustjs/crust": patch
---

Reject overlapping builds of the same project across processes using an exclusive .crust.lock directory. Release the lock on success or failure, preserve the current stage when another build holds it, and explain manual recovery after an interrupted process.
