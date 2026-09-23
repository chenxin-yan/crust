import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createFileSystemTypesCache } from "fumadocs-twoslash/cache-fs";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

// TODO(upstream): typescript@7.0.2's sync API throws `RangeError: Offset is outside the bounds of
// the DataView` (dist/api/node/node.js) when asked for hover info on Crust builder methods, whose
// inferred types are very large. Skip those identifiers until that is fixed; values keep their
// hovers. vite/landing-twoslash.ts carries the mirror-image allowlist.
const BUILDER_METHODS = new Set([
	"args",
	"flags",
	"command",
	"action",
	"extend",
	"provide",
	"add",
	"execute",
]);

const typeScriptGenerator = createGenerator({
	tsconfigPath: "tsconfig.json",
});

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

export default defineConfig({
	plugins: [lastModified()],
	mdxOptions: {
		// `npm` fences become npm/pnpm/yarn/bun tabs; one selection is shared and remembered site-wide.
		remarkNpmOptions: { persist: { id: "package-manager" } },
		// Auto type table paths are relative to the MDX file that declares them.
		remarkPlugins: [[remarkAutoTypeTable, { generator: typeScriptGenerator }]],
		rehypeCodeOptions: {
			themes: {
				light: "gruvbox-light-hard",
				dark: "gruvbox-dark-hard",
			},
			// Twoslash popups cannot lazy-load grammars, so every fence grammar used in content/ is preloaded (`text` is built in).
			langs: ["ts", "tsx", "sh", "json"],
			transformers: [
				...(rehypeCodeDefaultOptions.transformers ?? []),
				// `ts twoslash` fences get type hovers; results are cached by content hash beside the type-table cache.
				transformerTwoslash({
					typesCache: createFileSystemTypesCache({ dir: "node_modules/.cache/twoslash" }),
					twoslashOptions: {
						shouldGetHoverInfo: (id) => !BUILDER_METHODS.has(id),
					},
				}),
			],
		},
	},
});
