import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { runSteps } from "./steps.ts";

describe("runSteps", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("reports a missing editor through the stderr option", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "crust-create-steps-"));
		vi.stubEnv("EDITOR", "crust-missing-editor");
		const warnings: string[] = [];
		try {
			await runSteps([{ type: "open-editor" }], cwd, {
				stderr: (text) => warnings.push(text),
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
		expect(warnings).toEqual([
			expect.stringMatching(/^Warning: could not open editor "crust-missing-editor"/),
		]);
	});
});
