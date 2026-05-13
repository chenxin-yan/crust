---
"@crustjs/skills": patch
---

Internal: source-directory resolution moved to `@crustjs/utils`. No public API change. Resolves the dedup tech-debt note from `installSkillBundle`'s introduction.

Note: the `@internal`-tagged `resolveBundleSourceDir` export from `@crustjs/skills/bundle` was removed. It carried `@internal` JSDoc and was undocumented in the README and docs site (exported only for direct unit-test access in TP-003); its behavior is preserved by `resolveSourceDir` from `@crustjs/utils`.
