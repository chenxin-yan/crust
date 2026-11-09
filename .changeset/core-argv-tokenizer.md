---
"@crustjs/core": patch
---

Argv is now tokenized by Crust itself instead of `node:util`'s `parseArgs`, so Bun and Node report malformed argv with the same messages (an unknown short in `-zx` is `Unknown flag "-z"` on both). A `short` of one code point, such as `"😀"`, is now accepted and works alone and in clusters. A `-` inside a short cluster (`-v-x`) is reported as an unknown flag instead of ending flag parsing like `--`. When argv contains several errors, the first one in argv order is reported.
