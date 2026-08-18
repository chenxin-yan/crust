import { describe, expect, it } from "bun:test";

import { getAmbientTerminalIO, withAmbientTerminalIO } from "./terminal.ts";

describe("ambient terminal IO", () => {
	it("is absent outside a scope and available across async boundaries", async () => {
		const io = {
			stdout: (_text: string) => {},
			stderr: (_text: string) => {},
		};

		expect(getAmbientTerminalIO()).toBeUndefined();
		await withAmbientTerminalIO(io, async () => {
			await Promise.resolve();
			expect(getAmbientTerminalIO()).toBe(io);
		});
		expect(getAmbientTerminalIO()).toBeUndefined();
	});
});
