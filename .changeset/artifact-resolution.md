---
"@crustjs/core": minor
"@crustjs/skills": minor
"@crustjs/crust": patch
"create-crust": patch
---

New `resolveArtifactDir(name)` in `@crustjs/core` returns the absolute path of an Extension artifact or `crust.include` directory for the running layout: next to the executable inside a compiled Bun or Deno binary, next to the bundle's `bin/` directory in a Crust-built Node bundle (`.crust/root/<name>`, or the installed package root), `.crust/artifacts/<name>` while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), and `.crust/root/<name>` under the nearest `package.json` when running from source. Nothing is probed; callers report a missing directory themselves.

`@crustjs/skills`: `SkillOptions.distDir` is removed. The extension reads packaged skills from `resolveArtifactDir("skills")`, so `skill({})` is enough. `resolveSkillSource()` and the `dirname(process.execPath)` fallback are gone; `loadPackagedSkills(root)` takes the absolute root and throws `SkillSourceUnavailableError` (`Packaged skills not found at "<path>". Run \`crust build\` first.`) when it is missing or empty, which help renders as a note instead of failing.

`@crustjs/crust`: `crust build` defines `process.env.CRUST_BUILD` as `"1"` in every Bun and Node bundle it produces (CLI and `--bun-plugin` paths) so `resolveArtifactDir` can tell a staged bundle from source. `CRUST_BUILD` is reserved: reads of it in the bundled CLI are replaced at build time.

`create-crust` locates its `templates` directory through `resolveArtifactDir("templates")`.
