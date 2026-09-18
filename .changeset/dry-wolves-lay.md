---
"@crustjs/crust": minor
"create-crust": patch
---

Build every package.json bin source entry as a separate command, replacing crust.entry. Validate root names, reject duplicate entries and case-colliding command names, and merge isolated hook output with collision errors. Stage and validate all commands in root and platform packages. Scaffold runtime-specific source shebangs so npm link runs source; link .crust/root to exercise built output.
