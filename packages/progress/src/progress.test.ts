import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createProgressHandle, progress as createProgressBar } from "./progress.ts";
import { type SpinnerSink, withProgressSink } from "./spinner.ts";

const originalStderrWrite = process.stderr.write;
const originalStderrIsTTY = process.stderr.isTTY;

let stderrOutput: string;

beforeEach(() => {
	stderrOutput = "";
	process.stderr.write = (chunk: string | Uint8Array) => {
		if (typeof chunk === "string") stderrOutput += chunk;
		return true;
	};
	Object.defineProperty(process.stderr, "isTTY", {
		value: true,
		writable: true,
		configurable: true,
	});
});

afterEach(() => {
	process.stderr.write = originalStderrWrite;
	Object.defineProperty(process.stderr, "isTTY", {
		value: originalStderrIsTTY,
		writable: true,
		configurable: true,
	});
});

describe("progress — determinate", () => {
	it("threads the internal terminal sink through the spinner handle", () => {
		const writes: string[] = [];
		const sink: SpinnerSink = {
			isTTY: false,
			write: (text) => writes.push(text),
			exit: (code): never => {
				throw new Error(`exit:${code}`);
			},
		};
		const progress = createProgressHandle({ total: 2, message: "Files" }, sink);

		progress.start();
		progress.advance();
		progress.stop();

		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("Files (1/2)");
	});

	it("renders current/total alongside the message", () => {
		const progress = createProgressBar({ total: 10, message: "Translating" });

		progress.start();
		progress.advance(3);
		progress.stop();

		expect(stderrOutput).toContain("(3/10)");
		expect(stderrOutput).toContain("Translating");
		expect(stderrOutput).toContain("✓");
	});

	it("advance accepts a message and defaults to +1", () => {
		const progress = createProgressBar({ total: 2, message: "Files" });

		progress.start();
		progress.advance(1, "a.json");
		progress.advance(1, "b.json");
		progress.stop("success", "All files done");

		expect(stderrOutput).toContain("a.json (1/2)");
		expect(stderrOutput).toContain("b.json (2/2)");
		expect(stderrOutput).toContain("All files done (2/2)");
	});

	it("stop('error') renders the failure symbol", () => {
		const progress = createProgressBar({ total: 5, message: "Uploading" });

		progress.start();
		progress.advance(2);
		progress.stop("error", "Upload failed");

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("Upload failed (2/5)");
	});
});

describe("progress — sink resolution", () => {
	it("honors sink from options and the ambient withProgressSink sink", () => {
		const optionWrites: string[] = [];
		const ambientWrites: string[] = [];
		const makeSink = (writes: string[]): SpinnerSink => ({
			isTTY: false,
			write: (text) => writes.push(text),
			exit: (code): never => {
				throw new Error(`exit:${code}`);
			},
		});

		const viaOption = createProgressBar({
			message: "Upload",
			total: 2,
			sink: makeSink(optionWrites),
		});
		viaOption.start();
		viaOption.stop();

		withProgressSink(makeSink(ambientWrites), () => {
			const viaAmbient = createProgressBar({ message: "Sync", total: 2 });
			viaAmbient.start();
			viaAmbient.stop();
		});

		expect(optionWrites[0]).toContain("✓ Upload (0/2)");
		expect(ambientWrites[0]).toContain("✓ Sync (0/2)");
	});
});
