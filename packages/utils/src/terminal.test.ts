import { describe, expect, it } from "bun:test";

import {
	getAmbientTerminalIO,
	getTerminalIO,
	withAmbientTerminalIO,
	withTerminalIO,
} from "./terminal.ts";

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

	it("shares ambient callback lookup across bundled module copies", async () => {
		const first = (await import(
			new URL("./terminal.ts?copy=first", import.meta.url).href
		)) as typeof import("./terminal.ts");
		const second = (await import(
			new URL("./terminal.ts?copy=second", import.meta.url).href
		)) as typeof import("./terminal.ts");
		const io = { stdout: (_text: string) => {}, stderr: (_text: string) => {} };

		first.withAmbientTerminalIO(io, () => {
			expect(second.getAmbientTerminalIO()).toBe(io);
		});
	});

	it("line-buffers callback output through the shared stream scope", () => {
		const errors: string[] = [];
		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () => {
			const output = getTerminalIO()?.output;
			output?.write("first");
			output?.write(" line\nsecond\npartial");
		});
		expect(errors).toEqual(["first line", "second"]);
	});

	it("merges nested input and output scopes", () => {
		const input = process.stdin;
		const output = { write: (_text: string) => {} };
		withTerminalIO({ input }, () => {
			withTerminalIO({ output }, () => {
				expect(getTerminalIO()).toEqual({ input, output });
			});
		});
	});
});
