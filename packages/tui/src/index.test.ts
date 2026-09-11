import { describe, expect, it } from "bun:test";
import { PassThrough, Writable } from "node:stream";

import { type CliRenderer, type CliRendererConfig, KeyEvent, type ParsedKey } from "@opentui/core";

import { NonInteractiveError, runTui } from "./index.ts";

class TtyInput extends PassThrough {
	readonly isTTY = true;
	isRaw = false;

	setRawMode(mode: boolean): this {
		this.isRaw = mode;
		return this;
	}
}

function asReadStream(stream: PassThrough): NodeJS.ReadStream {
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
			stdout: stdout as NodeJS.WriteStream,
			width: 80,
			height: 24,
			bufferedOutput: "memory",
			...overrides,
		} satisfies CliRendererConfig,
	};
}

describe("runTui", () => {
	it("rejects before mounting when stdin is not a TTY", async () => {
		let mounted = false;
		const stdin = Object.assign(new PassThrough(), { isTTY: false });
		const stdout = Object.assign(new Writable({ write() {} }), { isTTY: true });

		await expect(
			runTui(
				() => {
					mounted = true;
				},
				{
					stdin: asReadStream(stdin),
					stdout: stdout as NodeJS.WriteStream,
				},
			),
		).rejects.toBeInstanceOf(NonInteractiveError);
		expect(mounted).toBe(false);
	});

	it("destroys the renderer and rethrows when mounting fails", async () => {
		const failure = new Error("mount failed");
		let renderer: CliRenderer | undefined;
		const { config } = createTtyConfig();

		await expect(
			runTui((created) => {
				renderer = created;
				throw failure;
			}, config),
		).rejects.toBe(failure);
		expect(renderer?.isDestroyed).toBe(true);
	});

	it("resolves when the renderer is destroyed", async () => {
		const { config } = createTtyConfig();

		await expect(runTui((renderer) => renderer.destroy(), config)).resolves.toBeUndefined();
	});

	it("rejects with AbortError when Ctrl+C destroys the renderer", async () => {
		const { config, stdin } = createTtyConfig();
		const result = runTui(() => {
			stdin.write("\x03");
		}, config);

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});

	it("settles on destroy while an async mount is still pending", async () => {
		const { config } = createTtyConfig();
		let listeners = -1;

		const result = runTui(async (renderer) => {
			setTimeout(() => {
				listeners = renderer.keyInput.listenerCount("keypress");
				renderer.destroy();
			}, 10);
			await new Promise<never>(() => {});
		}, config);

		await expect(result).resolves.toBeUndefined();
		expect(listeners).toBeGreaterThan(0);
		expect(config.stdin.listenerCount("data")).toBe(0);
	});

	it("removes its keypress listener after teardown", async () => {
		const { config } = createTtyConfig();
		let renderer: CliRenderer | undefined;
		let before = 0;

		await runTui((created) => {
			renderer = created;
			before = created.keyInput.listenerCount("keypress");
			created.destroy();
		}, config);

		// OpenTUI's own exitOnCtrlC handler stays; only the adapter's listener is removed.
		expect(renderer?.keyInput.listenerCount("keypress")).toBe(before - 1);
	});

	it("treats Ctrl+C with extra modifiers as a normal key, not cancellation", async () => {
		const { config } = createTtyConfig();

		const result = runTui((renderer) => {
			renderer.keyInput.emit("keypress", key({ name: "c", ctrl: true, shift: true }));
			setTimeout(() => renderer.destroy(), 10);
		}, config);

		await expect(result).resolves.toBeUndefined();
	});

	it("detects Ctrl+C through baseCode on non-Latin layouts", async () => {
		const { config } = createTtyConfig();

		const result = runTui((renderer) => {
			renderer.keyInput.emit("keypress", key({ name: "с", ctrl: true, baseCode: 99 }));
			setTimeout(() => renderer.destroy(), 10);
		}, config);

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});

	it("does not destroy on Ctrl+C when exitOnCtrlC is false", async () => {
		const { config, stdin } = createTtyConfig({ exitOnCtrlC: false });
		let renderer: CliRenderer | undefined;
		const result = runTui((created) => {
			renderer = created;
			stdin.write("\x03");
			setTimeout(() => created.destroy(), 10);
		}, config);

		await expect(result).resolves.toBeUndefined();
		expect(renderer?.isDestroyed).toBe(true);
	});
});
