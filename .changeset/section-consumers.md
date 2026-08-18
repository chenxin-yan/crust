---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/skills": minor
---

Add section consumer ids and audience filtering for help, man pages, and generated agent skills. Application-authored sections titled "Agent skills" are now preserved in generated skills.

Reserve the `crust:` namespace by convention for official identities; nothing enforces the prefix at runtime. Official Extension names are now `crust:help`, `crust:version`, `crust:completion`, `crust:did-you-mean`, `crust:no-color`, `crust:update-notifier`, `crust:man`, and `crust:skills`; the `HELP`, `MAN`, and `SKILLS` section consumer values are now `crust:help`, `crust:man`, and `crust:skills`. Third-party packages should namespace published identities with their own prefix.

Migrate raw section filters such as `only: ["skills"]` and `except: ["help"]` by importing and using `SKILLS`, `HELP`, or `MAN`; un-migrated raw filters still typecheck but silently stop matching, so the section vanishes from that renderer's output. Migrate `outcome.by` comparisons to compare against the configured Extension's `.name`, or use the new exact names (for example, `outcome.by === "crust:help"`). Error messages and other diagnostics that label an official Extension also contain its new `crust:*` name. Plain user Extension names remain valid and no longer collide with official Extensions that previously used the same flat name.
