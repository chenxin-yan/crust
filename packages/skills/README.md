# @crustjs/skills

Agent skill generation from Crust command definitions

## Install

```sh
bun add @crustjs/skills
```

## Focused imports

The root export remains available. Applications that use one feature can avoid loading the root barrel:

```ts
import { skill } from "@crustjs/skills/extension";
import { generateSkill } from "@crustjs/skills/generate";
```

Available subpaths are `agents`, `annotations`, `bundle`, `extension`, and `generate`.

## Build API

Render your CLI's generated skill and any authored skill bundles into a read-only skill source that can ship with your package:

```ts
import { writeSkills } from "@crustjs/skills";
import { app } from "./cli.ts";
import pkg from "./package.json" with { type: "json" };

await writeSkills(app, {
	outDir: "dist/skills",
	version: pkg.version,
	bundles: ["skills/deployment-guide"],
});
```

Each skill is written to its own directory under `outDir` with a self-describing `crust.json`. Generated command docs render each command's `meta.sections` as Markdown sections. If a generated and authored skill have the same name, `writeSkills()` throws `SkillSourceConflictError` before replacing `outDir`. The dedicated output directory is replaced on every build so removed skills cannot ship as stale files. `writeSkills()` does not touch the canonical store or agent directories.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)
