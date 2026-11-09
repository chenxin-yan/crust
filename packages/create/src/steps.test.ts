import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withTerminalIO } from "@crustjs/utils/terminal";
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

	// The step's shell command is POSIX `sleep`; the abort path itself is platform-neutral.
	it.skipIf(process.platform === "win32")(
		"terminates the running step and skips the rest when the ambient signal aborts",
		async () => {
			const controller = new AbortController();
			const reason = new DOMException("Terminated by SIGTERM.", "AbortError");
			const started = Date.now();
			const steps = withTerminalIO({ signal: controller.signal }, () =>
				runSteps(
					[
						{ type: "command", cmd: "sleep 20" },
						{ type: "command", cmd: "exit 3" },
					],
					tmpdir(),
				),
			);
			setTimeout(() => controller.abort(reason), 100);

			await expect(steps).rejects.toBe(reason);
			expect(Date.now() - started).toBeLessThan(10_000);
		},
	);
});
