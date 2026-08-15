# @crustjs/skills

Package and install agent skills for Crust CLIs.

## Install

```sh
bun add @crustjs/skills
```

## Build and ship a skill source

Render the generated command-reference skill and any authored bundles during your package build:

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

`outDir` must be named `skills`; add `dist/skills` to the package's `files` array. Each `skills/<name>/SKILL.md` follows the [Agent Skills specification](https://agentskills.io/specification) and declares required `name` and `description` frontmatter.

Enable opt-in installation from that packaged source:

```ts
import { Crust } from "@crustjs/core";
import { skill } from "@crustjs/skills";

export const app = new Crust("my-cli", { description: "My CLI" })
	.extend(
		skill({
			source: new URL("../skills", import.meta.url),
		}),
	)
	.action(() => {});
```

The contributed `skill` command creates symlinks from selected agent directories to the packaged skill directories. Project links are relative, so name-based package paths remain stable across npm, pnpm, and Bun reinstalls and updates; global links are absolute. This name-based behavior was [empirically verified](https://github.com/chenxin-yan/crust/blob/main/docs/research/skill-cleanup-lifecycle.md#7-round-4-empirical-symlink-verification-npm-1119--pnpm-1120--bun-1314-linux). There is no fallback install mechanism, ownership manifest, or mutable skill store.

Installed links always expose current package content. Before ordinary commands run, the extension silently repairs owned links whose target is missing or stale. It never creates an uninstalled link or replaces a real directory or foreign link. Uninstall removes only links whose target ends in `skills/<name>`.

Creating symlinks requires operating-system permission. If creation fails, installation reports how to enable symlink permission and stops.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)
