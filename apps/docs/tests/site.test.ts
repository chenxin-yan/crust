import { expect, it, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Glob, plugin } from "bun";

// Keep Fumadocs URL generation real without compiling every MDX page.
mock.module("fumadocs-mdx:collections/server", () => ({
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
mock.module("@tanstack/react-start", () => ({
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
  const handlers = sitemap.options.server?.handlers;
  if (typeof handlers !== "object" || typeof handlers.GET !== "function") {
    throw new Error("Missing sitemap GET handler");
  }
  const response: unknown = await Reflect.apply(handlers.GET, undefined, []);
  if (!(response instanceof Response)) throw new Error("Sitemap did not return a Response");
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
  if (typeof landing.options.loader !== "function") throw new Error("Missing landing loader");
  const data: unknown = await Reflect.apply(landing.options.loader, undefined, []);
  if (
    typeof data !== "object" ||
    data === null ||
    !("highlightedCode" in data) ||
    typeof data.highlightedCode !== "string"
  ) {
    throw new Error("Landing loader did not return highlighted code");
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
