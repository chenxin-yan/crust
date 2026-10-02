import { globSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { pageSchema } from "fumadocs-core/source/schema";
import { describe, expect, it } from "vite-plus/test";

import { type MdastNode, packagePageSchema, remarkPackageTable } from "../package-pages";
import docsConfig, { docs } from "../source.config";
import { MODULE_PACKAGES, PACKAGES } from "../src/lib/packages";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const modulesDir = fileURLToPath(new URL("../content/docs/modules/", import.meta.url));

// Published packages without a module page: workspace-internal utilities, and the
// project scaffolder, which the Quick Start covers.
const WITHOUT_MODULE_PAGE = new Set(["@crustjs/utils", "create-crust"]);

const published = globSync("packages/*/package.json", { cwd: repoRoot }).flatMap((path) => {
	const manifest = JSON.parse(readFileSync(`${repoRoot}${path}`, "utf8")) as {
		name: string;
		description: string;
		private?: boolean;
	};
	return manifest.private ? [] : [{ ...manifest, slug: basename(dirname(path)) }];
});

it("every published package with a module page is in PACKAGES under its directory name", () => {
	const documented = published.filter((pkg) => !WITHOUT_MODULE_PAGE.has(pkg.name));
	expect(
		Object.fromEntries(Object.entries(PACKAGES).map(([slug, pkg]) => [slug, pkg.name])),
	).toEqual(Object.fromEntries(documented.map((pkg) => [pkg.slug, pkg.name])));
	expect(MODULE_PACKAGES.map((pkg) => pkg.slug).sort()).toEqual(Object.keys(PACKAGES).sort());
});

it("the docs collection uses the package page schema and table plugin", () => {
	expect(docs.docs.schema).toBe(packagePageSchema);
	expect(docsConfig.mdxOptions).toMatchObject({
		remarkPlugins: expect.arrayContaining([remarkPackageTable]),
	});
});

describe("remarkPackageTable", () => {
	const packageTable = (group: string): MdastNode => ({
		type: "mdxJsxFlowElement",
		name: "PackageTable",
		attributes: [{ type: "mdxJsxAttribute", name: "group", value: group }],
		children: [],
	});
	const expand = (children: MdastNode[]) => {
		const tree: MdastNode = { type: "root", children };
		remarkPackageTable()(tree, { path: "index.mdx" });
		return tree.children ?? [];
	};

	it("renders the overview groups in sidebar order with package.json descriptions", () => {
		const overview = readFileSync(`${modulesDir}index.mdx`, "utf8");
		const groups = [...overview.matchAll(/^<PackageTable group="([^"]+)" \/>$/gm)].map(
			([, group]) => group ?? "",
		);
		const tables = expand(groups.map(packageTable));
		const rows = tables.map((table) => {
			expect(table.type).toBe("table");
			const [header, ...body] = table.children ?? [];
			expect(header?.children?.map((cell) => cell.children?.[0]?.value)).toEqual([
				"Module",
				"Description",
			]);
			return body.map(({ children: [link, description] = [] }) => ({
				name: link?.children?.[0]?.children?.[0]?.value,
				url: link?.children?.[0]?.url,
				description: description?.children?.[0]?.value,
			}));
		});
		const descriptions = Object.fromEntries(published.map((pkg) => [pkg.name, pkg.description]));
		const expectedRow = (slug: string) => ({
			name: `@crustjs/${slug}`,
			url: `/docs/modules/${slug}`,
			description: descriptions[`@crustjs/${slug}`],
		});
		expect(Object.fromEntries(groups.map((group, index) => [group, rows[index]]))).toEqual({
			spine: ["core", "extensions", "crust", "man", "skills"].map(expectedRow),
			"add-on": ["effect", "env", "mcp", "testing"].map(expectedRow),
			standalone: ["create", "progress", "prompts", "store", "style", "tui"].map(expectedRow),
		});
	});

	it("keeps other nodes and rejects an unknown group", () => {
		const paragraph: MdastNode = { type: "paragraph", children: [] };
		expect(expand([paragraph])).toEqual([paragraph]);
		expect(() => expand([packageTable("core")])).toThrow(
			'index.mdx from <PackageTable>: unknown group "core"',
		);
	});
});

describe("module page frontmatter", () => {
	const validate = (path: string, data: unknown) =>
		packagePageSchema({ path })["~standard"].validate(data);
	const pages = globSync(["*.mdx", "*/index.mdx"], { cwd: modulesDir });

	it.each(pages)("%s shows its package.json description", async (page) => {
		const path = `${modulesDir}${page}`;
		const data = frontmatter(readFileSync(path, "utf8")).data;
		const declared = pageSchema.parse(data);
		const result = await validate(path, data);
		const slug = page.replace(/(\/index)?\.mdx$/, "");
		const pkg = published.find((candidate) => candidate.slug === slug);
		expect(result).toEqual({
			value: { ...declared, description: pkg ? pkg.description : declared.description },
		});
	});

	it("rejects a frontmatter description on a package page", async () => {
		const result = await validate(`${modulesDir}core.mdx`, { title: "Core", description: "Copy" });
		expect(result.issues?.map((issue) => issue.message)).toEqual([
			"package pages take their description from package.json",
		]);
	});
});
