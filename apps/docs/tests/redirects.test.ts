import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

const pages = new Set(
	globSync("**/*.mdx", { cwd: fileURLToPath(new URL("../content/docs", import.meta.url)) }).map(
		(path) => `/docs/${path}`.replace(/(\/index)?\.mdx$/, ""),
	),
);

const rules = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8")
	.split("\n")
	.filter((line) => line.trim() && !line.startsWith("#"))
	.map((line) => line.split(/\s+/));

it("redirects lead from removed pages to existing pages, in both slash forms", () => {
	expect(pages).toContain("/docs");
	expect(rules.length).toBeGreaterThan(0);
	const targets = new Map(rules.map(([from, to]) => [from, to]));
	for (const [from, to, status] of rules) {
		const page = from.replace(/\/$/, "");
		expect(status, from).toBe("301");
		expect(pages, `target of ${from}`).toContain(to);
		expect(pages, `source ${from} is a live page`).not.toContain(page);
		// Cloudflare matches sources exactly, so the other slash form needs its own rule.
		expect(targets.get(from === page ? `${page}/` : page), `slash twin of ${from}`).toBe(to);
	}
});
