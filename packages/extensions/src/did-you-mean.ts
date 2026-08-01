import { type CommandSnapshot, CrustError, type Extension, defineExtension } from "@crustjs/core";

import { renderHelp } from "./help.ts";

export interface DidYouMeanOptions {
	/**
	 * Presentation mode for command-not-found errors.
	 *
	 * `"error"` writes the message and visible commands to stderr. `"help"`
	 * writes the message and parent command help to stdout.
	 *
	 * @default "error"
	 */
	mode?: "error" | "help";
}

function levenshtein(a: string, b: string): number {
	const aLen = a.length;
	const bLen = b.length;

	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	const row: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);

	for (let i = 1; i <= aLen; i++) {
		let prev = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const val = Math.min((row[j] as number) + 1, prev + 1, (row[j - 1] as number) + cost);
			row[j - 1] = prev;
			prev = val;
		}
		row[bLen] = prev;
	}

	return row[bLen] as number;
}

/**
 * Find canonical-name suggestions for `input` by matching against every
 * sibling's canonical name **and** any aliases declared on each sibling.
 *
 * Matched aliases are mapped back to their canonical, so suggestions only
 * ever report canonical names — mirroring `router.ts`, which records
 * canonicals on `commandPath`. When both a canonical and its alias score
 * within threshold, the better score wins for that command (a short alias
 * cannot lose to a more-distant canonical, and vice-versa).
 *
 * Subcommands marked `meta.hidden: true` are excluded from the candidate
 * set so internal commands (e.g. `__complete`) cannot leak into
 * user-facing typo suggestions. They remain invocable by direct name —
 * routing does not consult `meta.hidden`.
 *
 * The matching is limited to: (a) `candidate.startsWith(input)` (a
 * forward-completion hint, useful when the user typed a prefix) and
 * (b) Levenshtein distance ≤ 3. The reverse `input.startsWith(candidate)`
 * shortcut is intentionally omitted: with aliases in the candidate set,
 * any 1–2 char alias would falsely match every typo as distance 0.
 */
function findSuggestions(
	input: string,
	subCommands: Readonly<Record<string, CommandSnapshot>>,
): string[] {
	const best = new Map<string, number>();

	const score = (text: string): number | null => {
		if (text.startsWith(input)) return 0;
		const d = levenshtein(input, text);
		return d <= 3 ? d : null;
	};

	const record = (canonical: string, distance: number) => {
		const prev = best.get(canonical);
		if (prev === undefined || distance < prev) best.set(canonical, distance);
	};

	for (const [name, node] of Object.entries(subCommands)) {
		if (node.meta.hidden === true) continue;
		const d = score(name);
		if (d !== null) record(name, d);
		for (const alias of node.meta.aliases ?? []) {
			const da = score(alias);
			if (da !== null) record(name, da);
		}
	}

	return [...best.entries()]
		.sort(([aName, aDist], [bName, bDist]) =>
			aDist !== bDist ? aDist - bDist : aName.localeCompare(bName),
		)
		.map(([name]) => name);
}

export function didYouMeanExtension(options: DidYouMeanOptions = {}): Extension {
	const mode = options.mode ?? "error";

	return defineExtension("did-you-mean", {
		async handleError(error, context, next) {
			if (!(error instanceof CrustError) || !error.is("COMMAND_NOT_FOUND")) {
				await next();
				return;
			}

			const details = error.details;
			const suggestions = findSuggestions(details.input, details.parentCommand.subCommands);

			let message = `Unknown command "${details.input}".`;
			if (suggestions.length > 0) {
				message += ` Did you mean "${suggestions[0]}"?`;
			}

			if (mode === "help") {
				context.stdout(message);
				context.stdout("");
				context.stdout(renderHelp(details.parentCommand, details.commandPath));
				return;
			}

			// `details.available` lists every canonical sibling name including
			// those marked `meta.hidden: true`. The error message is user-
			// facing, so filter the same way `findSuggestions` does — internal
			// commands stay invocable but never surface in this list.
			const visibleAvailable = details.available.filter(
				(canonical) => details.parentCommand.subCommands[canonical]?.meta.hidden !== true,
			);
			if (visibleAvailable.length > 0) {
				message += `\n\nAvailable commands: ${visibleAvailable.join(", ")}`;
			}
			context.stderr(message);
			// Core preserves the nonzero exit code — rendering only here.
		},
	});
}
