---
"@crustjs/create": minor
"@crustjs/utils": minor
---

`scaffold()` copies a template directory exactly and writes the files that depend on the user's answers from code, so TypeScript checks what they contain.

```ts
import pkg from "../templates/base/package.json" with { type: "json" };

await scaffold({
  template: artifactPath("templates/base"),
  dest,
  files: { "package.json": `${JSON.stringify({ ...pkg, name }, null, "\t")}\n` },
});
```

- The template's files keep their bytes and modes: a Latin-1 file is no longer transcoded, and an executable script stays executable.
- `files` maps a path in the new project to its text. An entry wins over the template file at the same path and keeps that file's mode. A key outside the project or inside `.git` throws. A call needs `template`, `files`, or both; one with neither does not compile.
- `conflict: "replace"` empties the destination first and keeps `.git`. A destination holding only `.git` counts as empty.
- `dryRun: true` runs every check and returns the same `{ files }` without writing anything. All checks now run before the first write or deletion, and a call with nothing to write throws before deleting anything.
- `runSteps()`: `{ type: "install", packageManager }` installs with the given package manager. A failed step's error carries the child's `exitCode`.
- `packageManagerFromUserAgent()` is exported.

**Behavior change:** the `{{key}}` placeholders, the `context` and `render` options, and `interpolate()` are removed. Write the files that change from code with `files`, and render a prose file with a template engine of your choice.

**Behavior change:** the `install` and `command` steps send their children's standard output to standard error, so it never mixes with a CLI's own output such as `--json` results.

**Behavior change:** `detectPackageManager()` returns `undefined` when no lockfile or user agent names a package manager, instead of `"npm"`.

**Behavior change:** `scaffold()` returns its files sorted, and rejects a `dest` that exists and is not a directory, in a dry run as well.
