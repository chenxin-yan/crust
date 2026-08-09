import { type Extension, type ExtensionContext, defineExtension } from "@crustjs/core";

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
 * Previous values are restored after the command finishes. When overlapping
 * programmatic runs in one process use opposite flags, the later run wins
 * mid-flight (the env is process-global); the ambient values are restored
 * once all runs finish.
 */
// Overlapping execute() calls share process.env, so per-run snapshots would
// capture each other's temporary overrides and restores would race. Instead,
// the first active run captures the ambient values and the last one out
// restores them.
let activeRuns = 0;
let baseForceColor: string | undefined;
let baseNoColor: string | undefined;
const colorRuns = new WeakMap<ExtensionContext, true>();

export function noColorExtension(): Extension {
	return defineExtension("no-color", {
		flags: {
			color: {
				type: "boolean",
				description: "Enable colored output",
			},
		},
		hooks: {
			preRun(context) {
				const flagValue = context.flags.color;
				if (typeof flagValue !== "boolean") return;

				if (activeRuns === 0) {
					baseForceColor = process.env.FORCE_COLOR;
					baseNoColor = process.env.NO_COLOR;
				}
				activeRuns++;
				colorRuns.set(context, true);

				if (flagValue) {
					delete process.env.NO_COLOR;
					process.env.FORCE_COLOR = "3";
				} else {
					delete process.env.FORCE_COLOR;
					process.env.NO_COLOR = "1";
				}
			},
			postRun(context) {
				if (!colorRuns.has(context)) return;
				colorRuns.delete(context);
				activeRuns--;
				// ponytail: last-writer-wins while runs overlap; only the ambient
				// env is guaranteed restored once all runs finish.
				if (activeRuns === 0) {
					if (baseForceColor === undefined) delete process.env.FORCE_COLOR;
					else process.env.FORCE_COLOR = baseForceColor;
					if (baseNoColor === undefined) delete process.env.NO_COLOR;
					else process.env.NO_COLOR = baseNoColor;
				}
			},
		},
	});
}
