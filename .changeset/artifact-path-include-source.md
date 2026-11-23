---
"@crustjs/core": minor
"@crustjs/utils": minor
---

`artifactPath()` run from source resolves a path under a `crust.include` folder to that folder in the project, so templates and other shipped files are found before the first build and edits show up without rebuilding. Extension build artifacts, such as `skills`, still come from the last `crust build`.

**Behavior change:** from source, `artifactPath("templates")` with `"crust": { "include": ["templates"] }` returns `<project>/templates` instead of `<project>/.crust/root/templates`.
