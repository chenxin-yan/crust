---
"@crustjs/core": patch
"@crustjs/extensions": patch
"@crustjs/crust": patch
"create-crust": patch
"@crustjs/openapi": patch
"@crustjs/skills": minor
"@crustjs/create": minor
"@crustjs/utils": minor
---

Paths now follow one rule everywhere: a relative path resolves against the place it was written.

- A path the user types resolves against the working directory, with a leading `~` as the home directory. That now covers `create-crust [directory]` and its prompt, `completion --output-dir`, `--input @path`, and `api --body @path`, so `--output-dir=~/completions` and `--input @~/args.json` work where they used to name a directory called `~`.
- `type: "path"` also expands `~\` on Windows.
- A path passed in code resolves against the working directory, as Node's `fs` does.

**Behavior change:** in `@crustjs/skills`, a relative `sourceDir` (`installSkill()`, `getSkillStatus()`) or `extras` entry (`skill()`, `writeSkills()`) resolves against the working directory. It used to resolve against the nearest `package.json` above the CLI's entry file, which depended on how the CLI was distributed. During `crust build` the working directory is the project root, so `skill({ extras })` is unaffected there. Elsewhere, pass a path under `artifactPath()`, an absolute path, or a `file:` URL.

**Behavior change:** in `@crustjs/create`, a `command` step's relative `cwd` resolves against the directory passed to `runSteps()`, where it used to resolve against the process working directory. `scaffold()` rejects an empty `template`, and a `template` URL that is not `file:` fails with `Path URL must use the file: protocol`.

**Behavior change:** the `create-crust` prompt accepts the same directory paths as the positional argument, including `:` and `\`, so a Windows path such as `C:\projects\my-cli` can be typed. Only the basename is checked.

**Behavior change:** `resolveSourceDir()` is removed from `@crustjs/utils/source`. Use `resolvePathLike()` from `@crustjs/utils/path`.
