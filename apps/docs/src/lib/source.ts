import { llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { docs } from "fumadocs-mdx:collections/server";

export const source = loader({
	source: docs.toFumadocsSource(),
	baseUrl: "/docs",
	plugins: [lucideIconsPlugin()],
});

/** Serves `/llms.txt`, `/llms-full.txt` and each page's Markdown at `<page url>.md`. */
export const docsLlms = llms(source, {
	renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
