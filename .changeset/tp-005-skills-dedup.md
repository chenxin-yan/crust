---
"@crustjs/skills": patch
---

Internal: source-directory resolution moved to `@crustjs/utils`. Resolves the dedup tech-debt note from `installSkillBundle`'s introduction. The public function signature and behavior of `installSkillBundle()` are unchanged, but the wording of three thrown `Error` messages now comes from the shared helper:

- `"Bundle URL must use file: protocol, got ..."` → `"sourceDir URL must use file: protocol, got ..."`
- `"Could not resolve relative bundle path ..."` → `"Could not resolve relative sourceDir ..."` (both `process.argv[1]` unset and missing-`package.json` variants)

Consumers that match on `Error.message` text from these three failure modes will need to update their patterns. All other thrown messages (path-traversal rejection, `Bundle source directory does not exist`, missing `SKILL.md`, etc.) are unchanged.

Note: the `@internal`-tagged `resolveBundleSourceDir` export from `@crustjs/skills/bundle` was removed. It carried `@internal` JSDoc and was undocumented in the README and docs site (exported only for direct unit-test access in TP-003); its behavior is preserved by `resolveSourceDir` from `@crustjs/utils`.
