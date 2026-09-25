import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { remarkNpm } from "fumadocs-core/mdx-plugins";
import { expect, it, vi } from "vite-plus/test";

import docsConfig from "../source.config";

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

// Server functions run locally; Vite's native `?raw` transform supplies the example text.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Test mode has no Start server transport; execute the real handlers locally.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({ handler: <T>(fn: T) => fn }),
}));

const { Route: sitemap } = await import("../src/routes/sitemap[.]xml");
const { Route: landing, SCAFFOLD_COMMANDS } = await import("../src/routes/index");
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

it("landing highlights the checked greeting example", async () => {
	// The loader ignores router context; only the external registry boundary is stubbed.
	const load = landing.options.loader as () => Promise<typeof landing.types.loaderData>;
	const fetchSpy = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response(null, { status: 503 }));
	let data: typeof landing.types.loaderData;
	try {
		data = await load();
	} finally {
		fetchSpy.mockRestore();
	}
	expect(data.highlightedCode).toContain("--shiki-light");
	// The raw text inside `<code>`, with Shiki's token markup removed.
	const code = (/<code[^>]*>([\s\S]*)<\/code>/.exec(data.highlightedCode)?.[1] ?? "").replace(
		/<[^>]*>/g,
		"",
	);
	const example = await readFile(new URL("../examples/landing/greet.ts", import.meta.url), "utf8");
	expect(code).toBe(example.trimEnd());
}, 10000);

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
	expect(tabs && attribute(tabs, "groupId")).toBe("package-manager");
	const commands = Object.fromEntries(
		(tabs?.children ?? []).flatMap((child) =>
			child.name === "CodeBlockTab"
				? [[attribute(child, "value"), child.children?.[0]?.value]]
				: [],
		),
	);
	expect(commands).toEqual(SCAFFOLD_COMMANDS);
});
