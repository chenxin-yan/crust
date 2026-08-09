import { afterEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { snapshotEntrypoint } from "./build-helpers.ts";

describe("snapshotEntrypoint", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("returns the entry snapshot and exits before trailing code", async () => {
		const directory = await mkdtemp(join(tmpdir(), "crust-entry-snapshot-test-"));
		tempDirs.push(directory);
		const entry = join(directory, "cli.ts");
		const trailingMarker = join(directory, "trailing-code-ran");
		const coreUrl = pathToFileURL(resolve(import.meta.dir, "../../../core/src/index.ts")).href;
		await writeFile(
			entry,
			`import { Crust } from ${JSON.stringify(coreUrl)};\n` +
				`const app = new Crust("fixture", { description: "Fixture CLI" }).action(() => {});\n` +
				`await app.execute();\n` +
				`await Bun.write(${JSON.stringify(trailingMarker)}, "ran");\n`,
		);

		const root = await snapshotEntrypoint(entry);

		expect(root.meta).toEqual({ name: "fixture", description: "Fixture CLI" });
		expect(root.hasAction).toBe(true);
		await expect(access(trailingMarker)).rejects.toThrow();
	});
});
