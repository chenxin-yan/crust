import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateManPageFromEntry } from "./generate-man.ts";

describe("generateManPageFromEntry", () => {
	const tmpDir = join(import.meta.dir, ".tmp-generate-man");

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("rejects an entry whose app export lacks snapshot()", async () => {
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, "not-crust.ts"), "export const app = {};\n");

		await expect(
			generateManPageFromEntry({
				cwd: tmpDir,
				entry: "not-crust.ts",
				outfile: join(tmpDir, "out.1"),
			}),
		).rejects.toThrow("Man generation requires a Crust app exported as `app` or default export");
	});
});
