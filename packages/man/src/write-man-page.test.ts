import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import { writeManPage } from "./write-man-page.ts";

describe("writeManPage", () => {
	it("writes a prepared Command Snapshot", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-man-test-"));
		try {
			const root = await new Crust("demo", { description: "Demo CLI" }).action(() => {}).snapshot();
			const outfile = join(directory, "man", "demo.1");

			await writeManPage({ root, name: "demo", outfile, date: "January 1, 2020" });

			const mdoc = await readFile(outfile, "utf8");
			expect(mdoc).toContain(".Dd January 1, 2020");
			expect(mdoc).toContain(".Nm demo");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
