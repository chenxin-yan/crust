import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
	getAmbientTerminalIO,
	getTerminalIO,
	getTerminalSignal,
	isStdoutCaptured,
	registerLiveFrame,
	withAmbientTerminalIO,
	withCapturedStdout,
	withProcessTerminalSignal,
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

describe("terminal signal", () => {
	it("resolves the scope's signal before the process-wide one", async () => {
		const processSignal = new AbortController().signal;
		const scoped = new AbortController().signal;

		await withProcessTerminalSignal(processSignal, async () => {
			await Promise.resolve();
			expect(getTerminalSignal()).toBe(processSignal);
			withTerminalIO({ signal: scoped }, () => {
				withTerminalIO({ output: { write: () => {} } }, () => {
					expect(getTerminalSignal()).toBe(scoped);
				});
			});
		});
		expect(getTerminalSignal()).toBeUndefined();
	});
});

describe("captured stdout", () => {
	it("is scoped across async boundaries and shared by bundled module copies", async () => {
		const copy = (await import(
			new URL("./terminal.ts?copy=captured", import.meta.url).href
		)) as typeof import("./terminal.ts");
		expect(isStdoutCaptured()).toBe(false);
		await withCapturedStdout(async () => {
			await Promise.resolve();
			expect(copy.isStdoutCaptured()).toBe(true);
		});
		expect(isStdoutCaptured()).toBe(false);
	});
});

describe("writeProcessOutput", () => {
	afterEach(() => vi.restoreAllMocks());

	/** Capture fd writes, with `ttys` reporting as terminals. */
	function captureWrites(ttys: readonly number[]): string[] {
		const written: string[] = [];
		vi.spyOn(process.getBuiltinModule("node:tty"), "isatty").mockImplementation((fd) =>
			ttys.includes(fd),
		);
		vi.spyOn(process.getBuiltinModule("node:fs"), "writeSync").mockImplementation(((
			fd: number,
			buffer: Uint8Array,
			offset?: number,
		) => {
			written.push(`${fd}:${Buffer.from(buffer.subarray(offset)).toString("utf8")}`);
			return buffer.length - (offset ?? 0);
		}) as typeof import("node:fs").writeSync);
		return written;
	}

	it.skipIf(process.platform === "win32")(
		"erases a live frame before a line to a terminal and redraws it after",
		() => {
			const written = captureWrites([1, 2]);
			const release = registerLiveFrame({
				clear: () => written.push("clear"),
				redraw: () => written.push("redraw"),
			});
			try {
				writeProcessOutput(1, "built\n");
				writeProcessOutput(2, "partial");
			} finally {
				release();
			}
			writeProcessOutput(2, "after\n");

			expect(written).toEqual(["clear", "1:built\n", "redraw", "clear", "2:partial", "2:after\n"]);
		},
	);

	it.skipIf(process.platform === "win32")("leaves the frame alone for a redirected fd", () => {
		const written = captureWrites([2]);
		const release = registerLiveFrame({
			clear: () => written.push("clear"),
			redraw: () => written.push("redraw"),
		});
		try {
			writeProcessOutput(1, "to a file\n");
		} finally {
			release();
		}

		expect(written).toEqual(["1:to a file\n"]);
	});

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
