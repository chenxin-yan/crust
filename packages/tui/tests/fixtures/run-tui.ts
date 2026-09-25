// Runs one runTui scenario on Bun and prints what it observed; src/index.test.ts
// spawns this per test and owns every assertion. OpenTUI's native renderer is
// unavailable on the pinned Node 24, where the test runner lives.
import { PassThrough, Writable } from "node:stream";

import { type CliRenderer, type CliRendererConfig, KeyEvent, type ParsedKey } from "@opentui/core";

import { runTui } from "../../src/index.ts";

class TtyInput extends PassThrough {
	readonly isTTY = true;
	isRaw = false;

	setRawMode(mode: boolean): this {
		this.isRaw = mode;
		return this;
	}
}

function asReadStream(stream: PassThrough): NodeJS.ReadStream {
	// SAFETY: TtyInput implements the tty.ReadStream surface OpenTUI uses (isTTY, setRawMode, data events).
	// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- OpenTUI requires a concrete tty.ReadStream type; this fake implements the runtime surface it uses.
	return stream as unknown as NodeJS.ReadStream;
}

function key(overrides: Partial<ParsedKey> & Pick<ParsedKey, "name">): KeyEvent {
	return new KeyEvent({
		ctrl: false,
		meta: false,
		shift: false,
		option: false,
		sequence: "",
		number: false,
		raw: "",
		eventType: "press",
		source: "raw",
		...overrides,
	});
}

function createTtyConfig(overrides: CliRendererConfig = {}) {
	const stdin = new TtyInput();
	const stdout = Object.assign(
		new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		}),
		{ isTTY: true, columns: 80, rows: 24 },
	);

	return {
		stdin,
		config: {
			stdin: asReadStream(stdin),
			// SAFETY: the Writable carries the isTTY/columns/rows fields OpenTUI reads from a tty.WriteStream.
			stdout: stdout as NodeJS.WriteStream,
			width: 80,
			height: 24,
			bufferedOutput: "memory",
			...overrides,
		} satisfies CliRendererConfig,
	};
}

/** How the runTui promise settled; identity is checked here because it cannot cross the process. */
export type TuiOutcome =
	| { status: "resolved"; valueType: string }
	| { status: "rejected"; name: string; message: string; isMountFailure: boolean };

export type TuiObservation = {
	outcome: TuiOutcome;
	rendererDestroyed?: boolean;
	manualTeardownReached?: boolean;
	keypressListenersBefore?: number;
	keypressListenersAfter?: number;
	stdinDataListeners?: number;
};

async function settle(result: Promise<void>, mountFailure?: Error): Promise<TuiOutcome> {
	try {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- the observation records the resolved value's type for the test to assert.
		return { status: "resolved", valueType: typeof (await result) };
	} catch (error) {
		// SAFETY: every scenario rejects with an Error (the mount failure, AbortError or NonInteractiveError).
		const { name, message } = error as Error;
		return { status: "rejected", name, message, isMountFailure: error === mountFailure };
	}
}

export type TuiScenario =
	| "mount-failure"
	| "destroy-resolves"
	| "ctrl-c-aborts"
	| "destroy-during-pending-mount"
	| "keypress-listener-teardown"
	| "ctrl-shift-c"
	| "ctrl-c-base-code"
	| "ctrl-c-without-exit";

const scenarios = {
	"mount-failure": async () => {
		const failure = new Error("mount failed");
		let renderer: CliRenderer | undefined;
		const { config } = createTtyConfig();
		const outcome = await settle(
			runTui((created) => {
				renderer = created;
				throw failure;
			}, config),
			failure,
		);
		return { outcome, rendererDestroyed: renderer?.isDestroyed };
	},
	"destroy-resolves": async () => {
		const { config } = createTtyConfig();
		return { outcome: await settle(runTui((renderer) => renderer.destroy(), config)) };
	},
	"ctrl-c-aborts": async () => {
		const { config, stdin } = createTtyConfig();
		return {
			outcome: await settle(
				runTui(() => {
					stdin.write("\x03");
				}, config),
			),
		};
	},
	"destroy-during-pending-mount": async () => {
		const { config } = createTtyConfig();
		let listeners = -1;
		const outcome = await settle(
			runTui(async (renderer) => {
				setTimeout(() => {
					listeners = renderer.keyInput.listenerCount("keypress");
					renderer.destroy();
				}, 10);
				await new Promise<never>(() => {});
			}, config),
		);
		return {
			outcome,
			keypressListenersBefore: listeners,
			stdinDataListeners: config.stdin.listenerCount("data"),
		};
	},
	"keypress-listener-teardown": async () => {
		const { config } = createTtyConfig();
		let renderer: CliRenderer | undefined;
		let before = 0;
		const outcome = await settle(
			runTui((created) => {
				renderer = created;
				before = created.keyInput.listenerCount("keypress");
				created.destroy();
			}, config),
		);
		return {
			outcome,
			keypressListenersBefore: before,
			keypressListenersAfter: renderer?.keyInput.listenerCount("keypress"),
		};
	},
	"ctrl-shift-c": async () => {
		const { config } = createTtyConfig();
		return {
			outcome: await settle(
				runTui((renderer) => {
					renderer.keyInput.emit("keypress", key({ name: "c", ctrl: true, shift: true }));
					setTimeout(() => renderer.destroy(), 10);
				}, config),
			),
		};
	},
	"ctrl-c-base-code": async () => {
		const { config } = createTtyConfig();
		return {
			outcome: await settle(
				runTui((renderer) => {
					renderer.keyInput.emit("keypress", key({ name: "с", ctrl: true, baseCode: 99 }));
					setTimeout(() => renderer.destroy(), 10);
				}, config),
			),
		};
	},
	"ctrl-c-without-exit": async () => {
		const { config, stdin } = createTtyConfig({ exitOnCtrlC: false });
		let renderer: CliRenderer | undefined;
		let manualTeardownReached = false;
		const outcome = await settle(
			runTui((created) => {
				renderer = created;
				stdin.write("\x03");
				setTimeout(() => {
					manualTeardownReached = true;
					created.destroy();
				}, 10);
			}, config),
		);
		return { outcome, rendererDestroyed: renderer?.isDestroyed, manualTeardownReached };
	},
} satisfies Record<TuiScenario, () => Promise<TuiObservation>>;

// SAFETY: src/index.test.ts passes a TuiScenario; any other value fails on the undefined call.
const scenario = process.argv[2] as TuiScenario;
console.log(`OBSERVATION ${JSON.stringify(await scenarios[scenario]())}`);
