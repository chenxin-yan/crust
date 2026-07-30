import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import {
  createFileSystemGeneratorCache,
  createGenerator,
  remarkAutoTypeTable,
} from "fumadocs-typescript";

const typeScriptGenerator = createGenerator({
  tsconfigPath: "tsconfig.json",
  cache: createFileSystemGeneratorCache("node_modules/.cache/fumadocs-typescript"),
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
