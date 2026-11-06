import type { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";

import { isErrnoException } from "./error.ts";

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

const ignoreStreamError = () => {};

/**
 * Write to a process stream with `console.log`'s error tolerance: a downstream that closed
 * early (`cli | head`) surfaces as EPIPE, synchronously or as a later `error` event, and must
 * not crash the CLI. Mirrors Node's Console (`ignoreErrors: true`): a noop listener absorbs
 * the event when nobody else listens.
 */
function writeStream(stream: NodeJS.WriteStream, text: string): void {
	const absorb = () => {
		if (stream.listenerCount("error") === 0) stream.once("error", ignoreStreamError);
	};
	try {
		absorb();
		stream.write(text, (error) => {
			if (error) absorb();
		});
	} catch {
		// Synchronous write failure on an already-destroyed stream.
	} finally {
		// Async failures install their own one-shot listener in the write callback.
		stream.removeListener("error", ignoreStreamError);
	}
}

let retryPause: Int32Array | undefined;
const closedFds = new Set<number>();

/**
 * Returning only once every byte is written keeps output intact through an immediate
 * `process.exit()`. `EAGAIN` means a non-blocking pipe is full (Bun makes fd 1 non-blocking
 * once anything touches `process.stdout`): sleep 1 ms and retry rather than drop or reorder.
 * A closed reader or descriptor (`EPIPE` from `cli | head`, `EBADF`) closes the fd for later
 * writes silently, like `console.log`; other errors (`ENOSPC`) drop only the current write.
 */
function writeFd(fd: 1 | 2, text: string): void {
	if (closedFds.has(fd)) return;
	const { writeSync } = process.getBuiltinModule("node:fs");
	const buffer = Buffer.from(text);
	let offset = 0;
	while (offset < buffer.length) {
		try {
			offset += writeSync(fd, buffer, offset);
		} catch (error) {
			const code = isErrnoException(error) ? error.code : undefined;
			if (code !== "EAGAIN") {
				if (code === "EPIPE" || code === "EBADF") closedFds.add(fd);
				return;
			}
			Atomics.wait((retryPause ??= new Int32Array(new SharedArrayBuffer(4))), 0, 0, 1);
		}
	}
}

/**
 * Crust's process output, shared by Core's default `stdout`/`stderr` and first-party terminal
 * components so their writes reach each descriptor in call order. Outside Windows it writes
 * synchronously to fd 1 or 2: no `process.stdout`/`process.stderr` (and their `node:stream`
 * load), and no async tail for a `process.exit()` to truncate. Writes queued on those streams
 * by other code are a separate queue and are not ordered with these. Windows keeps the stream
 * writer: its console handling transcodes text, while raw bytes to a legacy console can garble
 * non-ASCII output.
 */
export function writeProcessOutput(fd: 1 | 2, text: string): void {
	if (process.platform === "win32") writeStream(fd === 1 ? process.stdout : process.stderr, text);
	else writeFd(fd, text);
}

/** Standard error as {@link TerminalOutput}, written through {@link writeProcessOutput}. */
export const processStderr: TerminalOutput = {
	get isTTY() {
		return process.getBuiltinModule("node:tty").isatty(2);
	},
	// Only drawing on a terminal reads the width, which needs the stream.
	get columns() {
		return process.stderr.columns;
	},
	write: (text) => writeProcessOutput(2, text),
};

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
