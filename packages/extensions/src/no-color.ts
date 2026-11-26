import {
	type ExtensionContext,
	type ExtensionFactory,
	CrustError,
	defineExtension,
} from "@crustjs/core";

// Overlapping execute() calls share process.env, so per-run snapshots would
// capture each other's temporary overrides and restores would race. Instead,
// the first active run captures the ambient values and the last one out
// restores them.
let activeRuns = 0;
let activeFlag: boolean | undefined;
let baseForceColor: string | undefined;
let baseNoColor: string | undefined;

const colorFlags = {
	color: {
		type: "boolean",
		negatable: true,
		description: "Enable colored output (--no-color to disable it)",
	},
} as const;

/** Set the color variables for `--color` (`true`) or `--no-color` (`false`); returns their restore. */
function applyColorFlag(flagValue: boolean): () => void {
	if (activeRuns > 0 && activeFlag !== flagValue) {
		throw new CrustError(
			"DEFINITION",
			"noColor: cannot start a --color run while a --no-color run is in flight (or vice versa); opposing overlapping runs share process.env",
			{ subject: "extension", name: noColor.id, reason: "opposing-overlap" },
		);
	}
	activeFlag = flagValue;

	if (activeRuns === 0) {
		baseForceColor = process.env.FORCE_COLOR;
		baseNoColor = process.env.NO_COLOR;
	}
	activeRuns++;

	if (flagValue) {
		delete process.env.NO_COLOR;
		process.env.FORCE_COLOR = "3";
	} else {
		delete process.env.FORCE_COLOR;
		process.env.NO_COLOR = "1";
	}
	return () => {
		activeRuns--;
		if (activeRuns > 0) return;
		activeFlag = undefined;
		if (baseForceColor === undefined) delete process.env.FORCE_COLOR;
		else process.env.FORCE_COLOR = baseForceColor;
		if (baseNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = baseNoColor;
	};
}

/**
 * Run `render` under the `--color` or `--no-color` typed before `--`, for output printed after a
 * failure that ended the run before `noColor()`'s setup applied the flag. The last one typed wins.
 */
export async function withTypedColorFlag<T>(
	context: ExtensionContext,
	render: () => Promise<T>,
): Promise<T> {
	if (context.command.flags.color?.extension !== noColor.id) return render();
	const end = context.argv.indexOf("--");
	// shortcut: a `--color` or `--no-color` meant for a passthrough argument counts too, since the hook cannot see where passthrough starts; upgrade if Core reports that boundary.
	const words = end === -1 ? context.argv : context.argv.slice(0, end);
	const on = words.lastIndexOf("--color");
	const off = words.lastIndexOf("--no-color");
	if (on === off) return render();
	const restore = applyColorFlag(on > off);
	try {
		return await render();
	} finally {
		restore();
	}
}

/**
 * Adds a recursive `--color` / `--no-color` flag pair that scopes the
 * standard color environment variables around command execution:
 *
 * - `--color` sets `FORCE_COLOR=3` (and clears `NO_COLOR`, so strict
 *   no-color.org-only child processes also comply) — forces all ANSI on
 *   (truecolor), overriding non-TTY detection. Any color library that
 *   honors `FORCE_COLOR` (including `@crustjs/style` and chalk) obeys it,
 *   and child processes inherit it.
 * - `--no-color` sets `NO_COLOR=1` (and clears `FORCE_COLOR` so the flag
 *   wins over ambient env) — suppresses colors while non-color modifiers
 *   and hyperlinks keep following TTY detection, per
 *   [no-color.org](https://no-color.org/).
 *
 * Previous values are restored after the command finishes. Overlapping
 * programmatic runs in one process may share a direction (both `--color` or
 * both `--no-color`); the ambient values are restored once all runs finish.
 * An overlapping run with the opposing flag throws a `CrustError` in
 * `setup`, because the env is process-global and cannot hold both values.
 */
export const noColor: ExtensionFactory<[], {}, [], typeof colorFlags> =
	/* @__PURE__ */ defineExtension("crust:no-color").factory((extension) =>
		extension
			.flags(colorFlags)
			// A setup, so the variables apply before any handler renders (`--help --no-color`).
			.setup((context) => {
				const flagValue = context.flags.color;
				if (flagValue === true || flagValue === false) context.defer(applyColorFlag(flagValue));
			}),
	);
