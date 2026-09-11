import {
	createCliRenderer,
	type CliRenderer,
	type CliRendererConfig,
	type KeyEvent,
} from "@opentui/core";

export type { CliRenderer, CliRendererConfig };

/** Thrown when stdin/stdout is not a TTY. Match with `error.name === "NonInteractiveError"` (same convention as `@crustjs/prompts`). */
export class NonInteractiveError extends Error {
	override readonly name = "NonInteractiveError";

	constructor(message = "TUI requires an interactive terminal (TTY).") {
		super(message);
	}
}

export type TuiMount = (renderer: CliRenderer) => void | Promise<void>;

// Mirrors OpenTUI's own exitOnCtrlC match (exact modifiers, `baseCode` for non-Latin layouts);
// its `matchesKeyBinding` helper is not exported.
function isCtrlC(event: KeyEvent): boolean {
	if (!event.ctrl || event.shift || event.meta || event.super) return false;
	return event.name === "c" || event.baseCode === 99;
}

export async function runTui(mount: TuiMount, config: CliRendererConfig = {}): Promise<void> {
	if (!(config.stdin ?? process.stdin).isTTY || !(config.stdout ?? process.stdout).isTTY) {
		throw new NonInteractiveError();
	}

	let aborted = false;
	let settle!: () => void;
	const destroyed = new Promise<void>((resolve) => (settle = resolve));
	const exitOnCtrlC = config.exitOnCtrlC ?? true;
	const renderer = await createCliRenderer({
		screenMode: "alternate-screen",
		consoleMode: "disabled",
		exitOnCtrlC: true,
		...config,
		onDestroy: () => {
			try {
				config.onDestroy?.();
			} finally {
				settle();
			}
		},
	});

	const onKeypress = (event: KeyEvent) => {
		if (isCtrlC(event)) aborted = true;
	};
	if (exitOnCtrlC) renderer.keyInput.on("keypress", onKeypress);

	// The app may destroy the renderer while `mount` is still pending (e.g. mount awaits the
	// app's lifetime), so settle on destroy rather than on mount completion.
	let mountFailure: { error: unknown } | undefined;
	void (async () => {
		try {
			await mount(renderer);
		} catch (error) {
			mountFailure = { error };
			if (!renderer.isDestroyed) renderer.destroy();
		}
	})();

	try {
		await destroyed;
	} finally {
		renderer.keyInput.off("keypress", onKeypress);
	}
	if (mountFailure) throw mountFailure.error;
	if (aborted) throw Object.assign(new Error("TUI cancelled"), { name: "AbortError" });
}
