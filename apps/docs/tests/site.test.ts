import { globSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { remarkNpm } from "fumadocs-core/mdx-plugins";
import { expect, it, vi } from "vite-plus/test";

import docsConfig from "../source.config";

// HAST is checked by twoslash.test.ts; these tests only need the route's static configuration.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Replace the build-only virtual module at the Vite boundary.
vi.mock("virtual:landing-twoslash", () => ({ default: {} }));

// Keep Fumadocs URL generation real without compiling every MDX page.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Adapt the Vite-only collection boundary; the actual Fumadocs loader still resolves every page.
vi.mock("fumadocs-mdx:collections/server", () => ({
	docs: {
		toFumadocsSource: () => ({
			files: globSync("**/*.mdx", {
				cwd: fileURLToPath(new URL("../content/docs", import.meta.url)),
			}).map((path) => ({ type: "page", path, data: { title: path } })),
		}),
	},
}));

// Server functions run locally without a Start server transport.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Execute the real handlers locally in test mode.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({ handler: <T>(fn: T) => fn }),
}));

const { Route: sitemap } = await import("../src/routes/sitemap[.]xml");
const { SCAFFOLD_COMMANDS } = await import("../src/routes/index");
const { source } = await import("../src/lib/source");
const { absoluteUrl } = await import("../src/lib/seo");

it("sitemap lists each Fumadocs page once, including the docs index", async () => {
	expect(source.getPage([])?.url).toBe("/docs");
	// This route declares a context-free GET, not a handler factory.
	const handlers = sitemap.options.server?.handlers as { GET: () => Promise<Response> };
	const response = await handlers.GET();
	const xml = await response.text();
	const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
	expect(response.headers.get("Content-Type")).toBe("application/xml");
	expect(locations).toEqual([
		absoluteUrl("/"),
		...source.getPages().map((page) => absoluteUrl(page.url)),
	]);
	expect(new Set(locations).size).toBe(locations.length);
});

it("every landing snippet the page renders exists on disk", async () => {
	// vite/landing-twoslash.ts reads these at build time; a typo would only surface as a build failure.
	const { SNIPPET_SOURCES } = await import("../src/components/landing/snippets");
	const { FEATURES } = await import("../src/components/landing/content");
	for (const feature of FEATURES) expect(SNIPPET_SOURCES).toHaveProperty(feature.code);
	for (const { file } of Object.values(SNIPPET_SOURCES)) {
		expect((await stat(new URL(`../${file}`, import.meta.url))).isFile()).toBe(true);
	}
});

it("landing scaffold tabs match the Quick Start `npm` fence and share its group", async () => {
	const quickStart = await readFile(
		new URL("../content/docs/quick-start.mdx", import.meta.url),
		"utf8",
	);
	const scaffoldLine = /```npm\n(.*)\n/.exec(quickStart)?.[1];
	expect(scaffoldLine).toBe(SCAFFOLD_COMMANDS.npm);

	// The mdast subtree, typed only as far as this test reads it.
	interface Node {
		type: string;
		lang?: string;
		name?: string;
		value?: string;
		attributes?: { type: string; name: string; value: unknown }[];
		children?: Node[];
	}
	const tree: Node = {
		type: "root",
		children: [{ type: "code", lang: "npm", value: scaffoldLine }],
	};
	// Same transform and options the docs build applies to that fence.
	const remarkNpmOptions = { persist: { id: "package-manager" } };
	expect(docsConfig.mdxOptions).toMatchObject({ remarkNpmOptions });
	await remarkNpm(remarkNpmOptions)(tree as never, {} as never, () => {});
	const attribute = (node: Node, name: string) =>
		node.attributes?.find((entry) => entry.type === "mdxJsxAttribute" && entry.name === name)
			?.value;
	const tabs = tree.children?.[0];
	expect(tabs?.name).toBe("CodeBlockTabs");
	const landingSource = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
	const landingGroup = /const PACKAGE_MANAGER_GROUP_ID = "([^"]+)"/.exec(landingSource)?.[1];
	expect(landingGroup).toBeDefined();
	expect(landingSource).toMatch(/<Tabs\s[^>]*groupId=\{PACKAGE_MANAGER_GROUP_ID\}/);
	expect(tabs && attribute(tabs, "groupId")).toBe(landingGroup);
	const commands = Object.fromEntries(
		(tabs?.children ?? []).flatMap((child) =>
			child.name === "CodeBlockTab"
				? [[attribute(child, "value"), child.children?.[0]?.value]]
				: [],
		),
	);
	expect(commands).toEqual(SCAFFOLD_COMMANDS);
});
