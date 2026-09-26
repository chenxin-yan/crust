---
"@crustjs/mcp": patch
---

Fall back to captured stdout instead of returning lossy structuredContent for completed results containing -0, array holes, named or symbol array keys, Array subclasses, or non-enumerable object keys.
