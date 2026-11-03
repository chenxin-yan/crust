import type { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";

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

const STORAGE_KEY: unique symbol = Symbol.for("crustjs.terminal.io");
const AMBIENT_CALLBACKS_KEY: unique symbol = Symbol.for("crustjs.terminal.ambient-callbacks");
type TerminalGlobals = {
	[STORAGE_KEY]?: AsyncLocalStorage<TerminalIO>;
	[AMBIENT_CALLBACKS_KEY]?: WeakMap<TerminalOutput, AmbientTerminalIO>;
};
// SAFETY: only declares the optional symbol slots read and initialized below.
const globals = globalThis as TerminalGlobals;

// Bundled copies in Core, Prompts, and Progress share process-wide terminal state. Both
// slots are created on first use: a top-level global write is a side effect bundlers keep.
function storage(): AsyncLocalStorage<TerminalIO> {
	return (globals[STORAGE_KEY] ??= new (process.getBuiltinModule(
		"node:async_hooks",
	).AsyncLocalStorage)<TerminalIO>());
}

function ambientCallbacks(): WeakMap<TerminalOutput, AmbientTerminalIO> {
	return (globals[AMBIENT_CALLBACKS_KEY] ??= new WeakMap());
}

/** Run a function with terminal streams available in its async scope. */
export function withTerminalIO<T>(io: TerminalIO, fn: () => T): T {
	const current = storage().getStore();
	return storage().run(
		{
			input: io.input ?? current?.input,
			output: io.output ?? current?.output,
		},
		fn,
	);
}

/** Return the terminal streams in the current async scope, if any. */
export function getTerminalIO(): TerminalIO | undefined {
	return storage().getStore();
}

function lineBufferedOutput(io: AmbientTerminalIO): TerminalOutput {
	let pending = "";
	// Only injected IO needs a stream; loading `node:stream` eagerly costs Bun startup.
	const output = new (process.getBuiltinModule("node:stream").Writable)({
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
	ambientCallbacks().set(output, io);
	return output;
}

/** Run a function with Core's line-oriented output bridged into the terminal stream scope. */
export function withAmbientTerminalIO<T>(io: AmbientTerminalIO, fn: () => T): T {
	const current = storage().getStore();
	return withTerminalIO(
		{
			input: current?.input,
			// Replace an enclosing invocation's bridge, but preserve explicitly supplied terminal streams.
			output:
				current?.output && !ambientCallbacks().has(current.output)
					? current.output
					: lineBufferedOutput(io),
		},
		fn,
	);
}

/** Return Core's line-oriented terminal output in the current async scope, if any. */
export function getAmbientTerminalIO(): AmbientTerminalIO | undefined {
	const output = storage().getStore()?.output;
	return output === undefined ? undefined : ambientCallbacks().get(output);
}
