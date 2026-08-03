import { type Extension, defineExtension } from "@crustjs/core";

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

/**
 * Adds an inheritable `--color` / `--no-color` flag pair that scopes the
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
 * Previous values are restored after the command finishes.
 */
// Overlapping execute() calls share process.env, so per-run snapshots would
// capture each other's temporary overrides and restores would race. Instead,
// the first active run captures the ambient values and the last one out
// restores them.
let activeRuns = 0;
let baseForceColor: string | undefined;
let baseNoColor: string | undefined;

export function noColorExtension(): Extension {
	return defineExtension("no-color", {
		flags: {
			color: {
				type: "boolean",
				inherit: true,
				description: "Enable colored output",
			},
		},
		async intercept(context, next) {
			const flagValue = context.flags.color;
			if (typeof flagValue !== "boolean") {
				await next();
				return;
			}

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

			try {
				await next();
			} finally {
				activeRuns--;
				// ponytail: last-writer-wins while runs overlap; only the ambient
				// env is guaranteed restored once all runs finish.
				if (activeRuns === 0) {
					setEnv("FORCE_COLOR", baseForceColor);
					setEnv("NO_COLOR", baseNoColor);
				}
			}
		},
	});
}
