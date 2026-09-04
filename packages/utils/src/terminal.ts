import { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";
import { Writable } from "node:stream";

/** A readable stream available to terminal libraries. */
export type TerminalInput = Readable & {
	readonly isTTY?: boolean;
	readonly isRaw?: boolean;
	setRawMode?: (mode: boolean) => void;
};

/** A writable-compatible output available to terminal libraries. */
export interface TerminalOutput {
	readonly isTTY?: boolean;
	readonly columns?: number;
	write(text: string): void;
}

/** Input and output streams available to terminal libraries. */
export interface TerminalIO {
	readonly input?: TerminalInput;
	readonly output?: TerminalOutput;
}

/** Line-oriented output callbacks ambiently supplied by Core invocations. */
export interface AmbientTerminalIO {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

const STORAGE_KEY = Symbol.for("crustjs.terminal.io");
const AMBIENT_CALLBACKS_KEY = Symbol.for("crustjs.terminal.ambient-callbacks");
// SAFETY: These intersections only declare the optional symbol slots read and initialized below.
const globalWithStorage = globalThis as typeof globalThis & {
	[key: symbol]: AsyncLocalStorage<TerminalIO> | undefined;
};
// SAFETY: This intersection only declares the optional symbol slot read and initialized below.
const globalWithAmbientCallbacks = globalThis as typeof globalThis & {
	[key: symbol]: WeakMap<TerminalOutput, AmbientTerminalIO> | undefined;
};

/** Bundled copies in Core, Prompts, and Progress share process-wide terminal state. */
const storage = (globalWithStorage[STORAGE_KEY] ??= new AsyncLocalStorage<TerminalIO>());
const ambientCallbacks = (globalWithAmbientCallbacks[AMBIENT_CALLBACKS_KEY] ??= new WeakMap<
	TerminalOutput,
	AmbientTerminalIO
>());

/** Run a function with terminal streams available in its async scope. */
export function withTerminalIO<T>(io: TerminalIO, fn: () => T): T {
	const current = storage.getStore();
	return storage.run(
		{
			input: io.input ?? current?.input,
			output: io.output ?? current?.output,
		},
		fn,
	);
}

/** Return the terminal streams in the current async scope, if any. */
export function getTerminalIO(): TerminalIO | undefined {
	return storage.getStore();
}

function lineBufferedOutput(io: AmbientTerminalIO): TerminalOutput {
	let pending = "";
	const output = new Writable({
		decodeStrings: false,
		write(chunk, _encoding, callback) {
			pending += chunk.toString();
			let newline = pending.indexOf("\n");
			while (newline !== -1) {
				io.stderr(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
			}
			callback();
		},
	});
	ambientCallbacks.set(output, io);
	return output;
}

/** Run a function with Core's line-oriented output bridged into the terminal stream scope. */
export function withAmbientTerminalIO<T>(io: AmbientTerminalIO, fn: () => T): T {
	const current = storage.getStore();
	return withTerminalIO(
		{ input: current?.input, output: current?.output ?? lineBufferedOutput(io) },
		fn,
	);
}

/** Return Core's line-oriented terminal output in the current async scope, if any. */
export function getAmbientTerminalIO(): AmbientTerminalIO | undefined {
	const output = storage.getStore()?.output;
	return output === undefined ? undefined : ambientCallbacks.get(output);
}
