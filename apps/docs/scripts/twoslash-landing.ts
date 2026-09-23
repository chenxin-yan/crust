// Precomputes Twoslash-annotated Shiki hast for the landing playground snippets.
// Runs under Node: typescript@7's sync API needs Node's child_process internals.
//   bun run twoslash:landing
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transformerTwoslash } from "fumadocs-twoslash";
import type { Root } from "hast";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langTypescript from "shiki/langs/typescript.mjs";
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES = {
	app: "examples/landing/app.ts",
	typed: "examples/landing/inputs.ts",
	schema: "examples/landing/schema.ts",
	contexts: "examples/landing/contexts.ts",
	testing: "examples/landing/testing.ts",
	extension: "examples/landing/extension.ts",
} satisfies Record<string, string>;

// Only values whose inferred type tells the story get a hover; builder methods are excluded
// because hovering them crashes typescript@7.0.2's sync API (RangeError in dist/api/node/node.js).
const HOVER = new Set([
	"port",
	"Port",
	"input",
	"format",
	"ctx",
	"database",
	"captured",
	"exitCode",
	"stderr",
	"preview",
	"deploy",
	"query",
	"sql",
	"line",
	"name",
	"run",
]);

const highlighter = await createHighlighterCore({
	themes: [gruvboxLightHard, gruvboxDarkHard],
	langs: [langTypescript],
	engine: createJavaScriptRegexEngine(),
});

const out: Record<string, Root> = {};
for (const [key, file] of Object.entries(SOURCES)) {
	const code = readFileSync(join(docsRoot, file), "utf8").trimEnd();
	out[key] = highlighter.codeToHast(code, {
		lang: "typescript",
		themes: { light: "gruvbox-light-hard", dark: "gruvbox-dark-hard" },
		defaultColor: false,
		transformers: [
			transformerTwoslash({
				explicitTrigger: false,
				twoslashOptions: { cwd: docsRoot, shouldGetHoverInfo: (id) => HOVER.has(id) },
			}),
		],
	});
}

const target = join(docsRoot, "src/generated/landing-twoslash.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out));
console.log(`wrote ${target} (${Object.keys(out).join(", ")})`);
