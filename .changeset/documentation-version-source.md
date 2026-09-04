---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/skills": minor
---

Add command sections to the shared documentation model and export `formatDefault` from `@crustjs/core/tooling`. Root command metadata now carries the application version so version, completion, update-notifier, and skill generation can use one source of truth while extension options remain overrides. Skill link-operation results now report their effective scope.
