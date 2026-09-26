import { transformerMetaHighlight } from "@shikijs/transformers";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

import { twoslashHovers } from "./twoslash.ts";

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
				transformerMetaHighlight(),
				...twoslashHovers(),
			],
		},
	},
});
