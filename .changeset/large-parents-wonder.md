---
"@crustjs/mcp": patch
---

Fall back to captured stdout instead of returning lossy structuredContent for completed results containing -0, array holes, named or symbol array keys, Array subclasses, or non-enumerable object keys. Result getters are now read exactly once into a detached copy, so a getter that changes between reads can no longer produce structured content that differs from what was validated. New own keys or array-length changes detected during an object's capture also fall back to stdout.
