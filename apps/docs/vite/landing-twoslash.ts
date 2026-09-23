// Virtual module `virtual:landing-twoslash`: Twoslash-annotated Shiki hast for the landing showcase
// snippets, computed when Vite loads it (dev, build, prerender) and re-computed when a snippet changes.
// Runs in Vite's Node process; typescript@7's sync API cannot run under Bun or in the worker runtime.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { transformerNotationHighlight } from "@shikijs/transformers";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";
import type { Root } from "hast";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langTypescript from "shiki/langs/typescript.mjs";
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";
import type { Plugin } from "vite";

const MODULE_ID = "virtual:landing-twoslash";
const RESOLVED_ID = `\0${MODULE_ID}`;

/** Snippet key (as used by the showcase's `SNIPPETS`) → source file, relative to apps/docs. */
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
	"to",
	"ctx",
	"db",
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

export function landingTwoslash(): Plugin {
	const root = process.cwd();
	const highlighter = createHighlighterCore({
		themes: [gruvboxLightHard, gruvboxDarkHard],
		langs: [langTypescript],
		engine: createJavaScriptRegexEngine(),
	});
	const twoslash = transformerTwoslash({
		explicitTrigger: false,
		twoslashOptions: { cwd: root, shouldGetHoverInfo: (id) => HOVER.has(id) },
		// Same cache the docs pages use; keyed by snippet content, so unchanged snippets skip TypeScript.
		typesCache: createFileSystemTypesCache({ dir: "node_modules/.cache/twoslash" }),
	});

	return {
		name: "landing-twoslash",
		resolveId(id) {
			return id === MODULE_ID ? RESOLVED_ID : undefined;
		},
		async load(id) {
			if (id !== RESOLVED_ID) return;
			const shiki = await highlighter;
			const out: Record<string, Root> = {};
			for (const [key, file] of Object.entries(SOURCES)) {
				const path = join(root, file);
				this.addWatchFile(path); // editing a snippet invalidates this module
				out[key] = shiki.codeToHast((await readFile(path, "utf8")).trimEnd(), {
					lang: "typescript",
					themes: { light: "gruvbox-light-hard", dark: "gruvbox-dark-hard" },
					defaultColor: false,
					// `// [!code highlight:N]` marker lines are removed and the next N lines get `.highlighted`.
					transformers: [transformerNotationHighlight(), twoslash],
				});
			}
			return `export default ${JSON.stringify(out)};`;
		},
	};
}
