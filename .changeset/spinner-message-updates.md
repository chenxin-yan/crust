---
"@crustjs/prompts": patch
---

Add `SpinnerController` with `updateMessage()` for changing the spinner message mid-task. The task callback now receives a controller object, enabling multi-step progress feedback. Success/error indicators display the latest message. Fully backward compatible — existing tasks that ignore the controller work unchanged.
