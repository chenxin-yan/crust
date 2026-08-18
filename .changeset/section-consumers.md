---
"@crustjs/core": major
"@crustjs/extensions": major
"@crustjs/man": major
"@crustjs/skills": major
---

Add audience filtering for command documentation sections. Sections are visible to every renderer by default; `only` and `except` target branded Extension identities. Help, man pages, and generated agent skills select their own audiences, and application-authored "Agent skills" sections remain preserved in generated skills.

Replace string Extension names and section consumers with branded `ExtensionId` values minted by `defineExtensionId()`. Extensions now expose `id`, accept soft `after` ordering constraints, and attribute handled failures through `InvocationOutcome.by`. Official identities retain their reserved `crust:*` namespace.

Official renderer identities now live on factory statics (`help.id`, `man.id`, and `skill.id`); the `HELP`, `MAN`, and `SKILLS` exports are removed. All official Extension factories expose their identity through `.id`.

Migrate Extension definitions from `defineExtension("acme:feature", config)` to `defineExtension(defineExtensionId("acme:feature"), config)`, and replace `.name` reads with `.id`. Replace section filters such as `only: ["skills"]` with factory statics such as `only: [skill.id]`; raw strings no longer typecheck. Compare attribution with factory statics too, for example `outcome.by === help.id`.

For `execute()` failures reached during dispatch, `onError` now settles before `postRun`. The handling Extension is available as `outcome.by`, and invocation Contexts remain pullable through `onError` and `postRun` before disposal. Core fallback rendering leaves `outcome.by` undefined.
