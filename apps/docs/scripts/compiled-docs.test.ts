import { afterAll, beforeAll, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

const docsRoot = resolve(import.meta.dir, "..");
// ponytail: one preview per host; allocate ports if these checks need to run in parallel.
const baseURL = "http://127.0.0.1:4317";
let preview: ReturnType<typeof Bun.spawn> | undefined;

beforeAll(async () => {
  if (!existsSync(resolve(docsRoot, "dist/server/index.js"))) {
    throw new Error("Run bun run build:docs before checking compiled documentation.");
  }
  // Do not let an old server satisfy readiness before --strictPort reports a collision.
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(4317, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
  preview = Bun.spawn(
    [
      "node",
      resolve(docsRoot, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4317",
      "--strictPort",
    ],
    { cwd: docsRoot, stdout: "ignore", stderr: "inherit" },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`Docs preview exited: ${preview.exitCode}`);
    try {
      if ((await fetch(`${baseURL}/llms.txt`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      // The local preview has not started listening yet.
    }
    await Bun.sleep(100);
  }
  throw new Error("Docs preview did not start within 30 seconds");
}, 35_000);

afterAll(async () => {
  preview?.kill();
  await preview?.exited;
});

it("serves source includes, generated property data, search and LLM content from compiled docs", async () => {
  const index = await fetch(`${baseURL}/llms.txt`);
  expect(index.status).toBe(200);
  expect(await index.text()).toContain("/docs/quick-start");

  const full = await fetch(`${baseURL}/llms-full.txt`);
  expect(full.status).toBe(200);
  expect(await full.text()).toContain('stdout(db.query("select 1"))');

  const context = await fetch(`${baseURL}/llms.mdx/docs/guide/contexts`);
  expect(context.status).toBe(200);
  expect(context.headers.get("content-type")).toContain("text/markdown");
  expect(await context.text()).toContain('stdout(db.query("select 1"))');

  const quickStart = await fetch(`${baseURL}/llms.mdx/docs/quick-start`);
  expect(quickStart.status).toBe(200);
  expect(await quickStart.text()).toContain("const outcome = await app.run(");

  const api = await fetch(`${baseURL}/llms.mdx/docs/api/crust`);
  expect(api.status).toBe(200);
  const reference = await api.text();
  expect(reference).toContain("<TypeTable");
  expect(reference).toContain("&#x22;name&#x22;: &#x22;sections&#x22;");
  expect(reference).not.toContain("<auto-type-table");

  const search = await fetch(`${baseURL}/api/search?query=Quick`);
  expect(search.status).toBe(200);
  const results: { url: string }[] = await search.json();
  expect(results.some((result) => result.url === "/docs/quick-start")).toBe(true);
});
