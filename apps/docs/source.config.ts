import { transformerMetaHighlight } from "@shikijs/transformers";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

import { packagePageSchema, remarkPackageTable } from "./package-pages.ts";
import { CODE_THEMES, twoslashHovers } from "./twoslash.ts";

const typeScriptGenerator = createGenerator({
	tsconfigPath: "tsconfig.json",
});

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		schema: packagePageSchema,
		postprocess: {
			// "string" renders at build time: the default renders at request time through `fumadocs-core/server`,
			// which resolves to its throwing browser stub in the Workers SSR environment.
			// TODO: back to `true` once fixed: https://github.com/fuma-nama/fumadocs/issues/3895
			includeProcessedMarkdown: { output: "string" },
		},
	},
});

export default defineConfig({
	plugins: [lastModified()],
	mdxOptions: {
		// `npm` fences become npm/pnpm/yarn/bun tabs; one selection is shared and remembered site-wide.
		remarkNpmOptions: { persist: { id: "package-manager" } },
		// Auto type table paths are relative to the MDX file that declares them.
		remarkPlugins: [[remarkAutoTypeTable, { generator: typeScriptGenerator }], remarkPackageTable],
		rehypeCodeOptions: {
			themes: CODE_THEMES,
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
