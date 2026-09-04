---
"@crustjs/style": patch
---

Make each omitted `CapabilityOverrides` property fall back to its matching runtime environment input instead of a partial override object clearing every unspecified capability.
