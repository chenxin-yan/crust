import {
	type CommandSnapshot,
	CrustError,
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { isListed } from "@crustjs/core/tooling";

import { renderHelp } from "./help.ts";

const DID_YOU_MEAN: ExtensionId = defineExtensionId("crust:did-you-mean");

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

	const row = Uint32Array.from({ length: bLen + 1 }, (_, i) => i);

	for (let i = 1; i <= aLen; i++) {
		let prev = i;
		for (let j = 1; j <= bLen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			// SAFETY: j is bounded to 1..bLen and row has bLen + 1 entries.
			const val = Math.min(row[j]! + 1, prev + 1, row[j - 1]! + cost);
			row[j - 1] = prev;
			prev = val;
		}
		row[bLen] = prev;
	}

	// SAFETY: row has bLen + 1 entries.
	return row[bLen]!;
}

/**
 * Find the best canonical-name suggestion for `input` by matching against every
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
function findSuggestion(
	input: string,
	subCommands: Readonly<Record<string, CommandSnapshot>>,
): string | undefined {
	let bestName: string | undefined;
	let bestDistance = Infinity;

	for (const [name, node] of Object.entries(subCommands)) {
		if (!isListed(node)) continue;
		let distance = Infinity;
		for (const spelling of [name, ...(node.meta.aliases ?? [])]) {
			distance = Math.min(distance, spelling.startsWith(input) ? 0 : levenshtein(input, spelling));
		}
		if (
			distance <= 3 &&
			(bestName === undefined ||
				distance < bestDistance ||
				(distance === bestDistance && name.localeCompare(bestName) < 0))
		) {
			bestName = name;
			bestDistance = distance;
		}
	}

	return bestName;
}

export const didYouMean: ExtensionFactory<[options?: DidYouMeanOptions]> = defineExtension(
	DID_YOU_MEAN,
	(options = {}) => {
		const mode = options.mode ?? "error";

		return {
			hooks: {
				onError(error, context) {
					if (!(error instanceof CrustError) || !error.is("COMMAND_NOT_FOUND")) return;

					const details = error.details;
					const suggestion = findSuggestion(details.input, details.parentCommand.subCommands);

					let message = `Unknown command "${details.input}".`;
					if (suggestion !== undefined) {
						message += ` Did you mean "${suggestion}"?`;
					}

					if (mode === "help") {
						context.stdout(message);
						context.stdout("");
						context.stdout(renderHelp(details.parentCommand, details.commandPath));
						return true;
					}

					if (details.available.length > 0) {
						message += `\n\nAvailable commands: ${details.available.join(", ")}`;
					}
					context.stderr(message);
					// Core preserves the nonzero exit code — rendering only here.
					return true;
				},
			},
		};
	},
);
