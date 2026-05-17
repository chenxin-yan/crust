---
"@crustjs/create": patch
---

Internal: source-directory resolution moved to `@crustjs/utils`. The public function signature and behavior of `createProject()` are unchanged, but the wording of three thrown `Error` messages now comes from the shared helper:

- `"Template URL must use file: protocol, got ..."` → `"sourceDir URL must use file: protocol, got ..."`
- `"Could not resolve relative template path ..."` → `"Could not resolve relative sourceDir ..."` (both `process.argv[1]` unset and missing-`package.json` variants)

Consumers that match on `Error.message` text from these three failure modes will need to update their patterns. All other thrown messages (`Template directory does not exist`, `Template path is not a directory`, destination-conflict, etc.) are unchanged.
