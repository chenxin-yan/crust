// Static JSON imports, unlike `import.meta.glob`, also resolve when the fumadocs-mdx CLI bundles
// source.config.ts with esbuild and when Node imports it directly (twoslash.test.ts).
// ponytail: the shared client entry ships these whole manifests (~2 kB gzip); pass names and
// descriptions through the landing loader if that weight matters.
import core from "../../../../packages/core/package.json" with { type: "json" };
import create from "../../../../packages/create/package.json" with { type: "json" };
import crust from "../../../../packages/crust/package.json" with { type: "json" };
import effect from "../../../../packages/effect/package.json" with { type: "json" };
import env from "../../../../packages/env/package.json" with { type: "json" };
import extensions from "../../../../packages/extensions/package.json" with { type: "json" };
import man from "../../../../packages/man/package.json" with { type: "json" };
import mcp from "../../../../packages/mcp/package.json" with { type: "json" };
import progress from "../../../../packages/progress/package.json" with { type: "json" };
import prompts from "../../../../packages/prompts/package.json" with { type: "json" };
import skills from "../../../../packages/skills/package.json" with { type: "json" };
import store from "../../../../packages/store/package.json" with { type: "json" };
import style from "../../../../packages/style/package.json" with { type: "json" };
import testing from "../../../../packages/testing/package.json" with { type: "json" };
import tui from "../../../../packages/tui/package.json" with { type: "json" };

export interface PackageManifest {
	name: string;
	description: string;
	peerDependencies?: Record<string, string>;
}

/** Packages with a module page, keyed by its slug (`modules/<slug>`), which is also the `packages/<slug>` directory. */
export const PACKAGES = {
	core,
	create,
	crust,
	effect,
	env,
	extensions,
	man,
	mcp,
	progress,
	prompts,
	skills,
	store,
	style,
	testing,
	tui,
} satisfies Record<string, PackageManifest>;

export type PackageSlug = keyof typeof PACKAGES;

export function isPackageSlug(slug: string): slug is PackageSlug {
	return Object.hasOwn(PACKAGES, slug);
}
