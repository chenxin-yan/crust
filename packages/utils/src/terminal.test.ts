import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
	getAmbientTerminalIO,
	getTerminalIO,
	withAmbientTerminalIO,
	withTerminalIO,
	writeProcessOutput,
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

describe("writeProcessOutput", () => {
	afterEach(() => vi.restoreAllMocks());

	// Windows writes through the process streams instead.
	it.skipIf(process.platform === "win32")(
		"drops only the failed write after a transient error such as ENOSPC",
		() => {
			const fs = process.getBuiltinModule("node:fs");
			const writeSync = fs.writeSync;
			const written: string[] = [];
			let failNext = true;
			vi.spyOn(fs, "writeSync").mockImplementation(((
				fd: number,
				buffer: Uint8Array,
				offset?: number,
			) => {
				if (fd !== 2) return writeSync(fd, buffer, offset);
				if (failNext) {
					failNext = false;
					throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
				}
				written.push(Buffer.from(buffer.subarray(offset)).toString("utf8"));
				return buffer.length - (offset ?? 0);
			}) as typeof writeSync);

			writeProcessOutput(2, "lost\n");
			writeProcessOutput(2, "kept\n");

			expect(written).toEqual(["kept\n"]);
		},
	);
});
