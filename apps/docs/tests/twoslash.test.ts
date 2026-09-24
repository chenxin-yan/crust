import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
		import { resolve } from "node:path";
		import { createHighlighter } from "shiki";
		import config from "./source.config.ts";
		import { twoslashHovers } from "./twoslash.ts";

		const options = config.mdxOptions.rehypeCodeOptions;
		const highlighter = await createHighlighter({ themes: ["gruvbox-light-hard"], langs: ["ts", "json"] });
		let nodes;
		const tree = highlighter.codeToHast(readFileSync("examples/landing/greet.ts", "utf8"), {
			lang: "ts", theme: "gruvbox-light-hard", meta: { __raw: "twoslash" },
			transformers: [...options.transformers, {
				name: "capture-types",
				preprocess() { nodes = this.meta.twoslash.nodes; },
			}],
		});
		assert.deepEqual(nodes.map(node => node.target), ["args", "flags", "name", "shout"]);
		assert.ok(nodes.every(node => node.type === "hover"));
		assert.match(nodes[0].text, /name: string/);
		assert.match(nodes[1].text, /shout: boolean/);
		assert.match(nodes[2].text, /string/);
		assert.match(nodes[3].text, /boolean/);
		const rendered = JSON.stringify(tree);
		assert.ok(rendered.includes("PopupTrigger"));
		assert.ok(!rendered.includes("twoslash-query-line"));
		assert.ok(!rendered.includes("^?"));

		const landing = twoslashHovers(false);
		for (const [file, targets] of [
			["landing/greet", ["args", "flags", "name", "shout"]],
			["landing/inputs", ["input", "to"]],
			["landing/schema", ["port"]],
			["landing/contexts", ["db"]],
			["landing/extension", ["preview"]],
			["landing/testing", ["exitCode", "stderr"]],
			["landing/app", []],
			["guide/types-builtin", ["flags", "seconds"]],
		]) {
			highlighter.codeToHast(readFileSync("examples/" + file + ".ts", "utf8"), {
				lang: "ts", theme: "gruvbox-light-hard",
				transformers: [...landing, {
					name: "check-selections",
					preprocess() {
						assert.deepEqual(this.meta.twoslash.nodes.map(node => node.target), targets, file);
					},
				}],
			});
		}
		const visibleText = node => node.type === "text" ? node.value : (node.children ?? []).map(visibleText).join("");
		for (const page of readdirSync("content/docs/guide").filter(file => file.endsWith(".mdx"))) {
			const guide = readFileSync("content/docs/guide/" + page, "utf8");
			const includes = [...guide.matchAll(/<include lang="(ts|json)"(?: meta=(['"])(.*?)\2)?>\s*([^<]+)<\/include>/g)];
			assert.equal(includes.length, (guide.match(/<include lang="(?:ts|json)"/g) ?? []).length, page);
			for (const [, lang, , meta = "", specifier] of includes) {
				const [file, region] = specifier.trim().split("#");
				let source = readFileSync(resolve("content/docs/guide", file), "utf8");
				if (region) {
					source = source.split("//#region " + region + "\n")[1]?.split("//#endregion")[0];
					assert.ok(source, specifier);
				}
				let queries = [];
				const hast = highlighter.codeToHast(source, {
					lang, theme: "gruvbox-light-hard", meta: { __raw: meta },
					transformers: [...options.transformers, {
						name: "capture-guide-types",
						preprocess() { queries = this.meta.twoslash?.nodes ?? []; },
					}],
				});
				const selected = [...source.matchAll(/\/\/\s*\^\?/g)].length;
				assert.equal(queries.length, selected, specifier);
				if (meta.includes("twoslash")) assert.ok(selected > 0, specifier);
				assert.ok(queries.every(node => node.type === "hover" && !node.text.includes(": any")), specifier);
				const html = JSON.stringify(hast);
				assert.ok(html.includes("highlighted"), specifier);
				const text = visibleText(hast);
				assert.ok(!text.includes("^?") && !text.includes("[!code"), specifier);
				if (selected) assert.ok(html.includes("PopupTrigger"), specifier);
			}
		}
		highlighter.dispose();
	`,
		],
		{
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			encoding: "utf8",
		},
	);
	expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
});
