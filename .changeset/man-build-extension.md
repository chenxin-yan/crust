---
"@crustjs/man": minor
---

Add `man(options?)`, a build-only Extension that writes an mdoc page under the build output's `man` directory. Manual section 1 is the default; `man({ section })` selects another section, and `man({ name })` sets the installed command name when it differs from the application name. `writeManPage()` remains available for custom build pipelines.
