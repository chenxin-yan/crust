---
"@crustjs/crust": minor
---

`crust publish` now checks each staged `name@version` on the target registry with `npm view` before uploading and skips versions that already exist, so rerunning after a partial failure resumes instead of failing on the packages that already went up. The lookup uses the same registry `npm publish` would (scoped `publishConfig` registry, then `--registry`, then `publishConfig.registry`); any answer other than "exists" or E404 aborts before anything is uploaded. `--dry-run` stays offline.
