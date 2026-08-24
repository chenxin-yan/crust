import { AsyncLocalStorage } from "node:async_hooks";

/** Line-oriented output callbacks ambiently available to terminal libraries. */
export interface AmbientTerminalIO {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

const STORAGE_KEY = Symbol.for("crustjs.terminal.ambient-io");
// SAFETY: This intersection only declares the optional symbol slot read and initialized below.
const globalWithStorage = globalThis as typeof globalThis & {
	[key: symbol]: AsyncLocalStorage<AmbientTerminalIO> | undefined;
};

/**
 * Bundled copies in Core, Prompts, and Progress must share one process-wide
 * storage instance. If the stored value shape changes, mint a new symbol key.
 */
const storage = (globalWithStorage[STORAGE_KEY] ??= new AsyncLocalStorage<AmbientTerminalIO>());

/** Run a function with line-oriented terminal output available in its async scope. */
export function withAmbientTerminalIO<T>(io: AmbientTerminalIO, fn: () => T): T {
	return storage.run(io, fn);
}

/** Return the line-oriented terminal output in the current async scope, if any. */
export function getAmbientTerminalIO(): AmbientTerminalIO | undefined {
	return storage.getStore();
}
