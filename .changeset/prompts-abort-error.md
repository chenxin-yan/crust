---
"@crustjs/prompts": minor
---

Prompt cancellation (Ctrl+C) now rejects with a standard `DOMException` named `"AbortError"` instead of the removed `CancelledError` class. Check `err.name === "AbortError"` to detect cancellation.
