---
"@crustjs/prompts": minor
"@crustjs/progress": minor
"@crustjs/testing": patch
---

Add `withTerminalIO()` to prompts and progress so prompts, spinners, and progress indicators share one ambient input/output scope. Existing `withPromptIO()` and `withProgressSink()` APIs remain as focused aliases, and `ProgressSink` now accepts writable-compatible outputs with optional TTY metadata.
