import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

it("docs and landing hovers explain selected values without builder or boilerplate hovers", () => {
	// TS7's synchronous API needs Node's child-process internals, which Bun does not implement.
	const result = spawnSync(
		"node",
		[
			"--input-type=module",
			"-e",
			String.raw`
		import assert from "node:assert/strict";
		import { readFileSync, readdirSync } from "node:fs";
		import { dirname, resolve } from "node:path";
		import { transformerNotationHighlight } from "@shikijs/transformers";
		import { remarkInclude } from "fumadocs-mdx/config";
		import { createHighlighter } from "shiki";
		import config from "./source.config.ts";
		import { SNIPPET_SOURCES } from "./src/components/landing/snippets.ts";
		import { twoslashHovers } from "./twoslash.ts";

		// Exact hover types a reader should learn, keyed by snippet then hovered token. Not every
		// selection is listed; count parity below keeps the rest honest.
		const EXPECTED_HOVERS = {
			"examples/landing/greet.ts": { args: "args: Simplify<{ name: string; }>", flags: "flags: { help: boolean | undefined; shout: boolean | undefined; }" },
			"examples/landing/inputs.ts": { to: "to: string" },
			"../../../examples/guide/arguments-defaults.ts": { format: "const format: string", label: "const label: string | undefined" },
			"../../../examples/guide/arguments-variadic.ts": { files: "const files: string[]" },
			"../../../examples/guide/arguments-choices.ts": { runtime: 'const runtime: "bun" | "node" | undefined' },
			"../../../examples/guide/flags-values.ts": { flags: 'flags: { runtime: "bun" | "node"; tag: string | undefined; target: string[] | undefined; }' },
			"../../../examples/guide/testing.ts#run": { outcome: "const outcome: RunOutcome<number>", result: "result: number" },
			"../../../examples/guide/contexts-uses.ts": { config: "config: Promise<{ region: string; }>" },
			"../../../examples/extensions/consumer.ts": { sections: "sections: readonly CommandSection[]" },
			"../../../examples/modules/env.ts#quick-example": { DATABASE_URL: "const DATABASE_URL: URL" },
			"../../../examples/modules/effect-env.ts#env-example": { PORT: "const PORT: number" },
		};

		const options = config.mdxOptions.rehypeCodeOptions;
		const highlighter = await createHighlighter({ themes: ["gruvbox-light-hard", "gruvbox-dark-hard"], langs: ["ts", "json"] });
		const children = node => node.children ?? [];
		const walk = node => [node, ...children(node).flatMap(walk)];
		const textOf = node => node.type === "text" ? node.value : children(node).map(textOf).join("");
		// What the reader sees in the code block: popup bodies render elsewhere.
		const codeText = node => node.type === "text" ? node.value : node.tagName === "PopupContent" ? "" : children(node).map(codeText).join("");
		const authoredHighlights = (source, meta) =>
			[...source.matchAll(/\[!code highlight(?::(\d+))?\]/g)].reduce((sum, [, lines = "1"]) => sum + Number(lines), 0) +
			[...(meta.match(/\{([\d,-]+)\}/)?.[1].split(",") ?? [])].reduce((sum, range) => {
				const [start, end = start] = range.split("-").map(Number);
				return sum + end - start + 1;
			}, 0);

		function checkRendered(key, source, meta, hast) {
			const nodes = walk(hast);
			const highlighted = nodes.filter(node => /\bline\b/.test(node.properties?.class ?? "") && /\bhighlighted\b/.test(node.properties.class));
			assert.equal(highlighted.length, authoredHighlights(source, meta), key + ": highlighted lines");
			const text = codeText(hast);
			for (const marker of ["^?", "[!code", "---cut---", "// @types"]) assert.ok(!text.includes(marker), key + ": visible " + marker);
			assert.ok(!nodes.some(node => /twoslash-query-line|twoslash-popup-container/.test(node.properties?.class ?? "")), key + ": inline type panel");
			const popups = nodes.filter(node => node.tagName === "Popup").map(popup => ({
				target: textOf(popup.children.find(child => child.tagName === "PopupTrigger")),
				// The first PopupContent child is the type; JSDoc prose follows it.
				type: textOf(popup.children.find(child => child.tagName === "PopupContent").children[0]).replace(/\s+/g, " "),
			}));
			// One popup per authored ^? selection: no automatic builder hovers, no dropped "any" hovers.
			assert.equal(popups.length, [...source.matchAll(/\/\/\s*\^\?/g)].length, key + ": " + JSON.stringify(popups));
			// app.css styles the hover cue under .twoslash.
			if (popups.length) assert.ok(nodes.some(node => node.tagName === "pre" && /\btwoslash\b/.test(node.properties.class)), key + ": no .twoslash block");
			for (const popup of popups) assert.ok(!/\bany\b/.test(popup.type), key + ": " + popup.type);
			for (const [target, type] of Object.entries(EXPECTED_HOVERS[key] ?? {})) {
				const popup = popups.find(popup => popup.target === target);
				assert.ok(popup, key + ": no hover on " + target);
				assert.equal(popup.type, type, key + ": " + target);
			}
			return popups.length;
		}

		// Landing: the same transformers and trimming as vite/landing-twoslash.ts.
		const landing = [transformerNotationHighlight(), ...twoslashHovers(false)];
		for (const { file, lang } of Object.values(SNIPPET_SOURCES)) {
			const source = readFileSync(file, "utf8").trimEnd();
			const hast = highlighter.codeToHast(source, {
				lang, themes: { light: "gruvbox-light-hard", dark: "gruvbox-dark-hard" }, defaultColor: false, transformers: landing,
			});
			checkRendered(file, source, "", hast);
		}

		// Expand each <include> with Fumadocs' own remark-include, so regions and dedent match the page.
		const checked = new Set();
		let plain = 0;
		let annotated = 0;
		const pages = [
			...readdirSync("content/docs/guide").filter(file => file.endsWith(".mdx")).map(file => "content/docs/guide/" + file),
			"content/docs/modules/env.mdx",
			"content/docs/modules/effect.mdx",
		];
		for (const page of pages) {
			const content = readFileSync(page, "utf8");
			const includes = [...content.matchAll(/<include lang="(ts|json)"(?: meta=(['"])(.*?)\2)?>\s*([^<]+?)\s*<\/include>/g)];
			assert.equal(includes.length, (content.match(/<include\b/g) ?? []).length, page);
			for (const [, lang, , meta = "", specifier] of includes) {
				const include = {
					type: "mdxJsxFlowElement", name: "include", children: [{ type: "text", value: specifier }],
					attributes: [{ type: "mdxJsxAttribute", name: "lang", value: lang }, ...(meta ? [{ type: "mdxJsxAttribute", name: "meta", value: meta }] : [])],
				};
				await remarkInclude.call({})({ type: "root", children: [include] }, { dirname: dirname(resolve(page)), cwd: process.cwd(), data: {} });
				assert.equal(include.type, "code", specifier);
				const hast = highlighter.codeToHast(include.value, {
					lang, theme: "gruvbox-light-hard", meta: { __raw: meta }, transformers: options.transformers,
				});
				const popups = checkRendered(specifier, include.value, meta, hast);
				if (meta.split(/\s+/).includes("twoslash")) assert.ok(popups > 0, specifier + ": twoslash meta without a selection");
				popups ? annotated++ : plain++;
				checked.add(specifier);
			}
		}
		assert.ok(plain > 0 && annotated > 0, "both plain and annotated includes are rendered");
		for (const key of Object.keys(EXPECTED_HOVERS)) if (!key.startsWith("examples/")) assert.ok(checked.has(key), key + " is not included by a checked page");
		highlighter.dispose();
	`,
		],
		{
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
}, 65_000);
