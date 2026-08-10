import { afterAll, describe, expect, it } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import { generateManPage } from "./generate-man.ts";

describe("generateManPage", () => {
	const tmpDir = join(import.meta.dir, ".tmp-generate-man");

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("writes a page from a prepared Command Snapshot", async () => {
		const root = await new Crust("demo", { description: "Demo CLI" }).action(() => {}).snapshot();
		const outfile = join(tmpDir, "out.1");

		await generateManPage({
			cwd: tmpDir,
			root,
			entry: "src/demo.ts",
			outfile,
		});

		const mdoc = await readFile(outfile, "utf8");
		expect(mdoc).toContain(".Nm demo");
		expect(mdoc).toContain(".Nd Demo CLI");
	});
});
