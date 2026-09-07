import { expect, it, mock, spyOn } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Glob, plugin } from "bun";

// Keep Fumadocs URL generation real without compiling every MDX page.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Adapt the Vite-only collection boundary; the actual Fumadocs loader still resolves every page.
await mock.module("fumadocs-mdx:collections/server", () => ({
  docs: {
    toFumadocsSource: () => ({
      files: [
        ...new Glob("**/*.mdx").scanSync(
          fileURLToPath(new URL("../content/docs", import.meta.url)),
        ),
      ].map((path) => ({ type: "page", path, data: { title: path } })),
    }),
  },
}));

// Server functions run locally; Vite's raw imports become text in Bun.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Bun has no Start server transport; execute the real handlers locally.
await mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: <T>(fn: T) => fn }),
}));
plugin({
  name: "vite-raw-example",
  setup(build) {
    build.onLoad({ filter: /greet\.ts\?raw$/ }, async ({ path }) => ({
      exports: { default: await readFile(path.slice(0, -4), "utf8") },
      loader: "object",
    }));
  },
});

const { Route: sitemap } = await import("../src/routes/sitemap[.]xml");
const { Route: landing } = await import("../src/routes/index");
const { source } = await import("../src/lib/source");
const { absoluteUrl } = await import("../src/lib/seo");

it("sitemap lists each Fumadocs page once, including the docs index", async () => {
  expect(source.getPage([])?.url).toBe("/docs");
  // This route declares a context-free GET, not a handler factory.
  const handlers = sitemap.options.server?.handlers as { GET: () => Promise<Response> };
  const response = await handlers.GET();
  const xml = await response.text();
  const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  expect(response.headers.get("Content-Type")).toBe("application/xml");
  expect(locations).toEqual([
    absoluteUrl("/"),
    ...source.getPages().map((page) => absoluteUrl(page.url)),
  ]);
  expect(new Set(locations).size).toBe(locations.length);
});

it("landing highlights the checked greeting example", async () => {
  // The loader ignores router context; only the external registry boundary is stubbed.
  const load = landing.options.loader as () => Promise<typeof landing.types.loaderData>;
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );
  let data: typeof landing.types.loaderData;
  try {
    data = await load();
  } finally {
    fetchSpy.mockRestore();
  }
  expect(data.highlightedCode).toContain("--shiki-light");
  let code = "";
  await new HTMLRewriter()
    .on("code", {
      text(chunk) {
        code += chunk.text;
      },
    })
    .transform(new Response(data.highlightedCode))
    .text();
  const example = await readFile(new URL("../examples/landing/greet.ts", import.meta.url), "utf8");
  expect(code.trimEnd()).toBe(example.trimEnd());
}, 10000);
