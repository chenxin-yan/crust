---
"@crustjs/crust": patch
---

`crust publish` now checks each staged `name@version` on the target registry with `npm view` before uploading and skips versions that already exist, so rerunning after a partial failure resumes instead of failing on the packages that already went up. The lookup replays the staged `publishConfig` registry settings to `npm view` so it targets the registry `npm publish` would (npm 11 precedence); any answer other than "exists" or E404 aborts before anything is uploaded. `--dry-run` stays offline.
