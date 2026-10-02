// Static JSON imports, unlike `import.meta.glob`, also resolve when the fumadocs-mdx CLI bundles
// source.config.ts with esbuild and when Node imports it directly (twoslash.test.ts).
// ponytail: the landing page ships these whole manifests (~2 kB gzip); pass names and descriptions
// through its loader if that weight matters.
import changesetConfig from "../../../../.changeset/config.json" with { type: "json" };
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
import modulesMeta from "../../content/docs/modules/meta.json" with { type: "json" };

interface PackageManifest {
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

export const PACKAGE_GROUPS = ["spine", "add-on", "standalone"] as const;

type PackageGroup = (typeof PACKAGE_GROUPS)[number];

export function isPackageSlug(slug: string): slug is PackageSlug {
	return Object.hasOwn(PACKAGES, slug);
}

// content/docs/modules/index.mdx states these rules above its tables: the spine is the fixed
// changeset release group, add-ons peer-depend on Core, and standalone libraries are the rest.
function packageGroup({ name, peerDependencies }: PackageManifest): PackageGroup {
	if (changesetConfig.fixed.some((group) => group.includes(name))) return "spine";
	if (peerDependencies?.["@crustjs/core"] !== undefined) return "add-on";
	return "standalone";
}

/** Module packages in sidebar order (modules/meta.json), with their overview group. */
export const MODULE_PACKAGES = modulesMeta.pages.filter(isPackageSlug).map((slug) => ({
	slug,
	name: PACKAGES[slug].name,
	description: PACKAGES[slug].description,
	group: packageGroup(PACKAGES[slug]),
}));
