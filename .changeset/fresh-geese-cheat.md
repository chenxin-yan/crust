---
"@crustjs/crust": patch
---

Add Windows ARM64 support to `crust build` and update distribution outputs.

- `crust build` now supports `windows-arm64` (`bun-windows-arm64`) as a compile target.
- Windows resolver generation now selects the correct binary for ARM64 and x64 hosts.
- Binary distribution templates and package metadata now explicitly include resolver files and compiled binaries.
- Build docs were updated to include the new Windows ARM64 target and output artifact.
