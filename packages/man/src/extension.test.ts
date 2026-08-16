import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import { man } from "./extension.ts";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("man Extension", () => {
	it("writes the root manual with a configurable section", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man({ section: 5 });
		const snapshot = await new Crust("demo", { description: "Demo CLI" })
			.extend(extension)
			.snapshot();

		await extension.build?.({ snapshot, outDir });

		const output = await readFile(join(outDir, "man", "demo.5"), "utf8");
		expect(output).toContain(".Dt DEMO 5");
		expect(output).not.toContain(outDir);
	});

	it("defaults to section 1", async () => {
		const outDir = await mkdtemp(join(tmpdir(), "crust-man-extension-"));
		directories.push(outDir);
		const extension = man();
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		await extension.build?.({ snapshot, outDir });

		expect(await readFile(join(outDir, "man", "demo.1"), "utf8")).toContain(".Dt DEMO 1");
	});
});
