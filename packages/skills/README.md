# @crustjs/skills

Package and install agent skills for Crust CLIs.

## Install

```sh
bun add @crustjs/skills
```

## Build

Add `skill({ source })` to copy the packaged source to `<outdir>/skills` during `crust build`; when unavailable, the Extension renders from the prepared Command Snapshot. Package builds stage the result automatically. `writeSkills()` remains available for custom pipelines, and `writeSkillsFromSnapshot()` accepts a prepared snapshot instead of a live app.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)
