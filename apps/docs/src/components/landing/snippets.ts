/**
 * Landing code snippets: key → source file (relative to apps/docs) and Shiki language.
 * vite/landing-twoslash.ts highlights these into `virtual:landing-twoslash`; the hero and the
 * showcase render them by key. The `.ts` files are type-checked with the site.
 */
export const SNIPPET_SOURCES = {
	greet: { file: "examples/landing/greet.ts", lang: "typescript" },
	app: { file: "examples/landing/app.ts", lang: "typescript" },
	typed: { file: "examples/landing/inputs.ts", lang: "typescript" },
	schema: { file: "examples/landing/schema.ts", lang: "typescript" },
	contexts: { file: "examples/landing/contexts.ts", lang: "typescript" },
	extension: { file: "examples/landing/extension.ts", lang: "typescript" },
	testing: { file: "examples/landing/testing.ts", lang: "typescript" },
	// The create-crust template's package.json, cropped to what `crust build` reads.
	build: { file: "examples/landing/package.json", lang: "json" },
} as const satisfies Record<string, { file: string; lang: "typescript" | "json" }>;

export type SnippetKey = keyof typeof SNIPPET_SOURCES;
