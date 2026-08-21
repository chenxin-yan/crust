---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/skills": minor
---

Add a shared documentation-section model with audience filtering.

- Commands can define plain-text `meta.sections`, and Extensions can append sections to canonical command paths during application preparation. Help and man-page output render the merged per-command sections after their built-in content, and generated man pages include sections from visible subcommands.
- Sections are visible to every renderer by default; `only` and `except` select audiences. Audiences accept Extension and renderer factory objects directly (`only: [skill]`), branded `ExtensionId` values minted by `defineExtensionId()` for custom renderers, and official renderer identities on factory statics (`help.id`, `man.id`, `skill.id`). The `crust:*` id namespace is reserved for official Extensions.
- Extensions are identified by branded ids: `defineExtension(defineExtensionId("acme:feature"), config)` — and expose that identity as `.id`. Handled `execute()` failures are attributed through `InvocationOutcome.by`; compare with factory statics, e.g. `outcome.by === help.id`. Core fallback rendering leaves `outcome.by` undefined.
- For `execute()` failures reached during dispatch, `onError` now settles before `postRun`. Invocation Contexts remain pullable through `onError` and `postRun` before disposal.
- Application-authored "Agent skills" sections are preserved in generated skills.
