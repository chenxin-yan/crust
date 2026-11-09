import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { progress as createProgressBar } from "./progress.ts";
import { createFakeSink } from "./test-helpers.ts";

beforeAll(() => vi.stubEnv("FORCE_COLOR", "0"));
afterAll(() => vi.unstubAllEnvs());

describe("progress — determinate", () => {
	it("advance and stop accept a replacement message", () => {
		const { sink, writes } = createFakeSink();
		const progress = createProgressBar({ total: 2, message: "Files", sink });

		progress.start();
		progress.advance(1, "a.json");
		progress.advance(1, "b.json");
		progress.stop("success", "All files done");

		const output = writes.join("");
		expect(output).toContain("a.json (1/2)");
		expect(output).toContain("b.json (2/2)");
		expect(output).toContain("All files done (2/2)");
	});

	it("keeps the count when a message wider than the terminal is cut", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 20, write: (text: string) => void writes.push(text) };
		const progress = createProgressBar({
			total: 2,
			message: "Uploading a long file name",
			sigint: false,
			sink,
		});

		progress.start();
		progress.advance();
		progress.stop();

		expect(writes[2]).toBe("\x1B[2K\r⠋ Uploading … (1/2)");
		expect(writes[3]).toBe("\x1B[2K\r✓ Uploading a long file name (1/2)\n");
	});

	it("stop('error') renders the failure symbol", () => {
		const { sink, writes } = createFakeSink();
		const progress = createProgressBar({ total: 5, message: "Uploading", sink });

		progress.start();
		progress.advance(2);
		progress.stop("error", "Upload failed");

		const output = writes.join("");
		expect(output).toContain("✗");
		expect(output).toContain("Upload failed (2/5)");
	});
});
