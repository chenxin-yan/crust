import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

// The optional disk cache does not invalidate when imported types change.
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
		},
	},
});
