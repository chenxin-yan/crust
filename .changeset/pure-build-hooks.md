---
"@crustjs/core": minor
"@crustjs/crust": minor
"@crustjs/man": minor
"@crustjs/skills": minor
"@crustjs/extensions": minor
---

### @crustjs/core

**Breaking:** Extension build hooks return their files instead of writing them. `build(ctx)` now returns `BuildArtifacts = readonly BuildFile[]`, where `BuildFile` is `{ path, content }` with `path` relative to `ctx.outDir` and `content` a `string` or `Uint8Array`. Returning `void` is no longer allowed. Core validates every path, rejects a path an earlier hook already produced (compared case-insensitively, naming both Extensions), writes the files under `outDir`, and records exactly the written paths; `BuildReport.extensions[].files` is always `readonly string[]` (the `"unknown"` marker is gone). `ctx.outDir` remains available for hooks that need to read earlier hooks' files or point an external tool at the tree.

Migration: replace `mkdir`/`writeFile` calls in a hook with returned entries.

```ts
// before
async build({ snapshot, outDir }) {
  await mkdir(join(outDir, "acme"), { recursive: true });
  await writeFile(join(outDir, "acme", "manifest.json"), JSON.stringify(snapshot));
  return ["acme/manifest.json"];
}
// after
build({ snapshot }) {
  return [{ path: "acme/manifest.json", content: JSON.stringify(snapshot) }];
}
```

### @crustjs/crust

`crust build` records each `bin` entry's Build Report under `build` in `.crust/manifest.json` (`build.<command>.extensions[].files`), so the manifest lists exactly which files every Extension produced. The field is absent under `--no-validate`, which skips the hooks. The build summary no longer prints `ran (artifacts not reported)`. Since hooks cannot produce symlinks anymore, multi-entry artifact merging no longer copies symlinks.

### @crustjs/man

The `man()` build hook returns the rendered page instead of writing it. `writeManPage()` is unchanged as a standalone render-and-write helper.

### @crustjs/skills

The `skill()` build hook returns rendered skill files instead of writing them. `writeSkills()` and `writeSkillsFromSnapshot()` now write into the `skills` output directory without deleting it first, so authored extras inside it are no longer rejected and unrelated files are left in place.

### @crustjs/extensions

The `completion()` build hook returns the three shell scripts instead of writing them. The runtime `completion <shell> --output-dir` command still writes all three files.
