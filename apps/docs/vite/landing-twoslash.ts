// Virtual module `virtual:landing-twoslash`: Shiki hast for the landing snippets (see
// src/components/landing/snippets.ts), Twoslash-annotated, computed when Vite loads the module
// (dev, build, prerender) and re-computed when a snippet changes. Runs in Vite's Node process;
// typescript@7's sync API cannot run under Bun or in the worker runtime.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { transformerNotationHighlight } from "@shikijs/transformers";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";
import type { Root } from "hast";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langJson from "shiki/langs/json.mjs";
import langTypescript from "shiki/langs/typescript.mjs";
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";
import type { Plugin } from "vite";

import { SNIPPET_SOURCES, type SnippetKey } from "../src/components/landing/snippets";

const MODULE_ID = "virtual:landing-twoslash";
const RESOLVED_ID = `\0${MODULE_ID}`;

// TODO: typescript@7.0.2's sync API throws `RangeError: Offset is outside the bounds of
// the DataView` (dist/api/node/node.js) when asked for hover info on Crust builder methods, whose
// inferred types are very large. Until that is fixed, only the values whose types tell the story get
// a hover — which also keeps the payload small. source.config.ts carries the mirror-image denylist.
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
		langs: [langTypescript, langJson],
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
			const out: Partial<Record<SnippetKey, Root>> = {};
			for (const [key, { file, lang }] of Object.entries(SNIPPET_SOURCES)) {
				const path = join(root, file);
				this.addWatchFile(path); // editing a snippet invalidates this module
				// SAFETY: `Object.entries` widens the key to string; SNIPPET_SOURCES has only SnippetKey keys.
				out[key as SnippetKey] = shiki.codeToHast((await readFile(path, "utf8")).trimEnd(), {
					lang,
					themes: { light: "gruvbox-light-hard", dark: "gruvbox-dark-hard" },
					defaultColor: false,
					// `// [!code highlight:N]` marker lines are removed and the next N lines get `.highlighted`;
					// Twoslash only runs on TypeScript.
					transformers: [transformerNotationHighlight(), twoslash],
				});
			}
			return `export default ${JSON.stringify(out)};`;
		},
	};
}
