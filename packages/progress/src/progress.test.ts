import { describe, expect, it } from "bun:test";

import { progress as createProgressBar } from "./progress.ts";
import { withProgressSink } from "./spinner.ts";
import { createFakeSink } from "./test-helpers.ts";

describe("progress — determinate", () => {
	it("renders current/total alongside the message", () => {
		const { sink, writes } = createFakeSink();
		const progress = createProgressBar({ total: 10, message: "Translating", sink });

		progress.start();
		progress.advance(3);
		progress.stop();

		const output = writes.join("");
		expect(output).toContain("(3/10)");
		expect(output).toContain("Translating");
		expect(output).toContain("✓");
	});

	it("advance accepts a message and defaults to +1", () => {
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

describe("progress — sink resolution", () => {
	it("honors sink from options and the ambient withProgressSink sink", () => {
		const option = createFakeSink(false);
		const ambient = createFakeSink(false);

		const viaOption = createProgressBar({
			message: "Upload",
			total: 2,
			sink: option.sink,
		});
		viaOption.start();
		viaOption.advance();
		viaOption.stop();

		withProgressSink(ambient.sink, () => {
			const viaAmbient = createProgressBar({ message: "Sync", total: 2 });
			viaAmbient.start();
			viaAmbient.stop();
		});

		expect(option.writes[0]).toContain("✓ Upload (1/2)");
		expect(ambient.writes[0]).toContain("✓ Sync (0/2)");
	});
});
