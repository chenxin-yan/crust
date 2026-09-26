import {
	type ExtensionFactory,
	type ExtensionId,
	type ExtensionContext,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const NO_COLOR: ExtensionId = defineExtensionId("crust:no-color");

// Overlapping execute() calls share process.env, so per-run snapshots would
// capture each other's temporary overrides and restores would race. Instead,
// the first active run captures the ambient values and the last one out
// restores them.
let activeRuns = 0;
let activeFlag: boolean | undefined;
let baseForceColor: string | undefined;
let baseNoColor: string | undefined;
const colorRuns = new WeakSet<ExtensionContext>();

const colorFlags = [
	{
		name: "color",
		type: "boolean",
		description: "Enable colored output",
	},
] as const;

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
 * `preRun`, because the env is process-global and cannot hold both values.
 */
export const noColor: ExtensionFactory<[], {}, [], typeof colorFlags> = defineExtension(
	NO_COLOR,
).factory((extension) =>
	extension
		.flags(...colorFlags)
		.preRun((context) => {
			const flagValue = context.flags.color;
			if (flagValue !== true && flagValue !== false) return;

			if (activeRuns > 0 && activeFlag !== flagValue) {
				throw new CrustError(
					"DEFINITION",
					"noColor: cannot start a --color run while a --no-color run is in flight (or vice versa); opposing overlapping runs share process.env",
					{ subject: "extension", name: NO_COLOR, reason: "opposing-overlap" },
				);
			}
			activeFlag = flagValue;

			if (activeRuns === 0) {
				baseForceColor = process.env.FORCE_COLOR;
				baseNoColor = process.env.NO_COLOR;
			}
			activeRuns++;
			colorRuns.add(context);

			if (flagValue) {
				delete process.env.NO_COLOR;
				process.env.FORCE_COLOR = "3";
			} else {
				delete process.env.FORCE_COLOR;
				process.env.NO_COLOR = "1";
			}
		})
		.postRun((context) => {
			if (!colorRuns.has(context)) return;
			colorRuns.delete(context);
			activeRuns--;
			if (activeRuns === 0) {
				activeFlag = undefined;
				if (baseForceColor === undefined) delete process.env.FORCE_COLOR;
				else process.env.FORCE_COLOR = baseForceColor;
				if (baseNoColor === undefined) delete process.env.NO_COLOR;
				else process.env.NO_COLOR = baseNoColor;
			}
		}),
);
