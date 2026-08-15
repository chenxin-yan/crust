# @crustjs/skills

Package and install agent skills for Crust CLIs.

## Install

```sh
bun add @crustjs/skills
```

## Build and ship a skill source

Render the generated command-reference skill and any authored bundles once during your package build:

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

Add `dist/skills` to the package's `files` array. Each skill directory is self-describing and includes a `crust.json` ownership and version marker.

Enable opt-in installation from that read-only source:

```ts
import { skill } from "@crustjs/skills";

app.extend(
	skill({
		source: new URL("../skills", import.meta.url),
	}),
);
```

The contributed `skill` command copies every shipped skill into selected agent directories. Installed copies auto-update when the package source version changes. Update and uninstall operations leave directories without the matching ownership marker untouched. No separate mutable skill store or link-based install mode is used.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)
