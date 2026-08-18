import { describe, expect, it } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import { getAmbientTerminalIO, withAmbientTerminalIO } from "./terminal.ts";

const STORAGE_KEY = Symbol.for("crustjs.terminal.ambient-io");

function createIO(name: string) {
	return {
		stdout: (_text: string) => name,
		stderr: (_text: string) => name,
	};
}

describe("ambient terminal IO", () => {
	it("is absent outside a scope and available across async boundaries", async () => {
		const io = createIO("scoped");

		expect(getAmbientTerminalIO()).toBeUndefined();
		await withAmbientTerminalIO(io, async () => {
			await Promise.resolve();
			expect(getAmbientTerminalIO()).toBe(io);
		});
		expect(getAmbientTerminalIO()).toBeUndefined();
	});

	it("restores the nearest scope when scopes nest", () => {
		const outer = createIO("outer");
		const inner = createIO("inner");

		withAmbientTerminalIO(outer, () => {
			expect(getAmbientTerminalIO()).toBe(outer);
			withAmbientTerminalIO(inner, () => expect(getAmbientTerminalIO()).toBe(inner));
			expect(getAmbientTerminalIO()).toBe(outer);
		});
	});

	it("isolates concurrent async scopes", async () => {
		const first = createIO("first");
		const second = createIO("second");

		const seen = await Promise.all([
			withAmbientTerminalIO(first, async () => {
				await Bun.sleep(5);
				return getAmbientTerminalIO();
			}),
			withAmbientTerminalIO(second, async () => {
				await Promise.resolve();
				return getAmbientTerminalIO();
			}),
		]);

		expect(seen).toEqual([first, second]);
	});

	it("keeps the process-wide storage when initialization repeats", () => {
		const globalWithStorage = globalThis as typeof globalThis & {
			[key: symbol]: AsyncLocalStorage<ReturnType<typeof createIO>> | undefined;
		};
		const storage = globalWithStorage[STORAGE_KEY];
		const duplicateModuleStorage = (globalWithStorage[STORAGE_KEY] ??= new AsyncLocalStorage());
		const io = createIO("shared");

		expect(storage).toBeInstanceOf(AsyncLocalStorage);
		if (!storage) throw new Error("ambient terminal storage was not initialized");
		expect(duplicateModuleStorage).toBe(storage);
		withAmbientTerminalIO(io, () => expect(storage.getStore()).toBe(io));
	});
});
